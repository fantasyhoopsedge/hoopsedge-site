import { type NextRequest, NextResponse } from "next/server";

const FANTRAX_BASE = "https://www.fantrax.com/fxea/general";

const ALLOWED_ACTIONS = new Set([
  "getLeagues",
  "getLeagueInfo",
  "getStandings",
  "getDraftResults",
]);

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const action = searchParams.get("action");

  if (!action || !ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Invalid or missing action" }, { status: 400 });
  }

  const params = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (key !== "action") params.set(key, value);
  }

  const url = `${FANTRAX_BASE}/${action}?${params.toString()}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        Referer: "https://www.fantrax.com/",
      },
      cache: "no-store",
    });

    const text = await upstream.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "Non-JSON response from Fantrax", preview: text.slice(0, 400) },
        { status: 502 }
      );
    }

    return NextResponse.json(json, { status: upstream.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upstream request failed" },
      { status: 502 }
    );
  }
}
