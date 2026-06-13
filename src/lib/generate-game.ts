import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/utils/supabase/admin";
import type { GameTier, QuestionType } from "@/types/database";

/**
 * Core agent-generation logic, shared by:
 *   - the scheduled worker route (src/app/api/agent/generate-pitch/route.ts)
 *   - the Skip action (src/app/admin/predictions/actions.ts), which queues a
 *     replacement game the moment the boss skips one.
 *
 * Asks Claude Opus 4.8 for a prediction prop (structured outputs guarantee the
 * schema — no markdown), validates it, inserts it as status='draft' via the
 * service-role client, and best-effort posts a Discord embed.
 */

const MODEL = "claude-opus-4-8";

const TIERS: readonly GameTier[] = ["nightly", "monthly", "seasonal"];
const Q_TYPES: readonly QuestionType[] = [
  "boolean",
  "single_choice",
  "multi_choice",
  "ranking",
];

/** The exact shape Claude must return. Drives the structured-output schema. */
type AgentPitch = {
  title: string;
  tier: GameTier;
  q_type: QuestionType;
  options: string[];
  deadline: string; // ISO 8601
  description: string; // clean, user-facing subtitle shown on the game card
  boss_pitch: string; // internal sell — Discord/admin announcement only, never shown to users
};

// Structured-output JSON schema. Note the API's strict-schema rules: every
// object needs additionalProperties:false and lists every property as required.
// Array length ("exactly 4") and other count constraints aren't enforceable in
// the schema, so we validate them in code after parsing.
const PITCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    tier: { type: "string", enum: TIERS },
    q_type: { type: "string", enum: Q_TYPES },
    options: { type: "array", items: { type: "string" } },
    deadline: { type: "string", format: "date-time" },
    description: { type: "string" },
    boss_pitch: { type: "string" },
  },
  required: ["title", "tier", "q_type", "options", "deadline", "description", "boss_pitch"],
} as const;

const SYSTEM_PROMPT = `You are the FantasyHoopsEdge (FHE) Prediction Arena content agent. Your job is to invent ONE fresh, engaging NBA prediction prop for FHE's dynasty/fantasy audience and return it as structured data.

Rules:
- Pick a tier that fits the question's time horizon: 'nightly' (tonight's slate), 'monthly' (a month-long leader/breakout race), or 'seasonal' (awards, standings, dynasty arcs).
- Pick a q_type: 'boolean' (yes/no), 'single_choice' (pick one), 'multi_choice' (pick several), or 'ranking' (order them).
- "options" must contain EXACTLY 4 entries, each a real player or clearly-labelled choice as a plain string.
- "deadline" must be a FUTURE ISO-8601 timestamp — strictly after the current date/time given in the user message — appropriate to the tier (a nightly prop locks at tip-off tonight; a seasonal one near season's end). Never use a past date.
- "description" is a single punchy sentence shown to END USERS on the game card. Write it for fans — engaging and specific. NEVER address "Boss" and NEVER begin with "Hi Boss".
- "boss_pitch" is INTERNAL — it goes only to the admin review channel, never to users — and MUST begin with exactly: "Hi Boss, I am ready to post a new prediction game" — then a short, energetic 1-2 sentence pitch for why this prop will drive engagement.
- Keep titles punchy and specific.

Here is one example of a well-formed pitch to match in style and structure:

{
  "title": "2026 Draft Riser: Who climbs the FHE dynasty board first?",
  "description": "A draft-night race between Keaton Wagler, Darius Acuff, and the top of the 2026 board — who rises first?",
  "tier": "seasonal",
  "q_type": "single_choice",
  "options": ["Keaton Wagler", "Darius Acuff", "Cameron Boozer", "AJ Dybantsa"],
  "deadline": "2026-06-25T23:59:00Z",
  "boss_pitch": "Hi Boss, I am ready to post a new prediction game — a draft-night riser prop pitting Keaton Wagler against Darius Acuff and the top of the board, perfect for our dynasty crowd in the run-up to the draft."
}

Return a brand-new prop (do not reuse the example).`;

/**
 * Defensive parse. Structured outputs already guarantee clean JSON, but if a
 * future model/config ever wraps the payload in prose or a ```json fence, strip
 * to the outermost braces before JSON.parse so the write query never chokes.
 */
function parsePitch(raw: string): AgentPitch {
  let text = raw.trim();

  // Drop a leading ```json / ``` fence and trailing ``` if present.
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  // Clip to the first '{' .. last '}' to shed any conversational intro/outro.
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    text = text.slice(first, last + 1);
  }

  return JSON.parse(text) as AgentPitch;
}

/** Reject anything that wouldn't satisfy the DB / arena contract. */
function validatePitch(p: AgentPitch): string | null {
  if (!p || typeof p !== "object") return "Pitch is not an object.";
  if (typeof p.title !== "string" || !p.title.trim()) return "Missing title.";
  if (typeof p.description !== "string" || !p.description.trim()) return "Missing description.";
  if (!TIERS.includes(p.tier)) return `Invalid tier: ${p.tier}`;
  if (!Q_TYPES.includes(p.q_type)) return `Invalid q_type: ${p.q_type}`;
  if (!Array.isArray(p.options) || p.options.length !== 4) {
    return "options must contain exactly 4 entries.";
  }
  if (!p.options.every((o) => typeof o === "string" && o.trim())) {
    return "Every option must be a non-empty string.";
  }
  if (typeof p.deadline !== "string" || Number.isNaN(Date.parse(p.deadline))) {
    return `Invalid deadline: ${p.deadline}`;
  }
  if (Date.parse(p.deadline) <= Date.now()) {
    return `Deadline is in the past: ${p.deadline}`;
  }
  if (
    typeof p.boss_pitch !== "string" ||
    !p.boss_pitch.startsWith("Hi Boss, I am ready to post a new prediction game")
  ) {
    return "boss_pitch must open with the required greeting.";
  }
  return null;
}

export type GenerateResult =
  | { ok: true; gameId: string; reviewUrl: string; webhookDelivered: boolean }
  | { ok: false; status: number; error: string; detail?: string };

/**
 * Generate one game, insert it as a draft, and announce it.
 * `siteUrl` is used to build the review link (no request object here, so the
 * caller passes it — typically NEXT_PUBLIC_SITE_URL or the request origin).
 */
export async function generateGameDraft(opts: {
  siteUrl: string;
}): Promise<GenerateResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 500, error: "ANTHROPIC_API_KEY is not configured." };
  }

  const anthropic = new Anthropic({ apiKey });

  // Anchor the model to the real clock — without this it invents a plausible
  // but often past-dated deadline from its training cutoff.
  const nowIso = new Date().toISOString();

  let pitch: AgentPitch;
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: "adaptive" },
      output_config: {
        format: { type: "json_schema", schema: PITCH_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `The current date and time is ${nowIso}. Generate one new NBA prediction prop for the FHE Prediction Arena. The "deadline" you choose MUST be a real timestamp in the future relative to this moment.`,
        },
      ],
    });

    const jsonText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    pitch = parsePitch(jsonText);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 502, error: "Failed to generate or parse the agent pitch.", detail };
  }

  const invalid = validatePitch(pitch);
  if (invalid) {
    return { ok: false, status: 422, error: "Agent pitch failed validation.", detail: invalid };
  }

  // Insert as a draft (service-role: bypasses RLS / column grants).
  const admin = createAdminClient();
  const { data: inserted, error: insertError } = await admin
    .from("prediction_games")
    .insert({
      title: pitch.title,
      description: pitch.description, // clean, user-facing blurb
      tier: pitch.tier,
      question_type: pitch.q_type, // model field q_type → DB column question_type
      options: pitch.options,
      deadline: pitch.deadline,
      status: "draft",
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return { ok: false, status: 500, error: "Failed to write draft game.", detail: insertError?.message };
  }

  const reviewUrl = `${opts.siteUrl.replace(/\/$/, "")}/admin/predictions`;
  const webhookDelivered = await dispatchDiscord(pitch, inserted.id, reviewUrl);

  return { ok: true, gameId: inserted.id, reviewUrl, webhookDelivered };
}

/** Best-effort Discord embed. A failure never affects the saved draft. */
async function dispatchDiscord(
  pitch: AgentPitch,
  gameId: string,
  reviewUrl: string,
): Promise<boolean> {
  const webhookUrl = process.env.AGENT_WEBHOOK_URL;
  if (!webhookUrl) return false;

  const deadlineUnix = Math.floor(Date.parse(pitch.deadline) / 1000);
  const discordPayload = {
    username: "FHE Prediction Agent",
    embeds: [
      {
        title: "🏀 New prediction draft ready for review",
        description: `${pitch.boss_pitch}\n\n**[Review & approve →](${reviewUrl})**`,
        color: 0xff6b2b,
        fields: [
          { name: "Title", value: pitch.title },
          { name: "Tier", value: pitch.tier, inline: true },
          { name: "Type", value: pitch.q_type, inline: true },
          { name: "Options", value: pitch.options.map((o, i) => `${i + 1}. ${o}`).join("\n") },
          { name: "Locks", value: `<t:${deadlineUnix}:F>` },
        ],
        footer: { text: `game ${gameId}` },
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload),
    });
    return res.ok; // Discord returns 204 on success
  } catch {
    return false;
  }
}
