# Refreshing current.csv from HoopsHype

`data/nba-salaries/current.csv` is refreshed by hand, in the owner's own
browser, never by a script this repo runs on its own. This file is the
step-by-step for doing that refresh and merging the result back in safely.

## Why this is manual (read this before automating any part of it)

`scripts/nba-data/salary_ingest.ts` says it outright: no salary website is
ever fetched, scraped, or requested by code in this repo. The browser
console snippet below runs in the owner's own logged-in tab — it's not
different in kind from the owner copying numbers into a spreadsheet by hand,
it's just faster. If you're ever asked to "automate the HoopsHype refresh,"
the answer is no — point back to this file and to `salary_ingest.ts`'s
docstring instead.

## Step 1 — scrape the visible table

Paste this into DevTools console on the HoopsHype salaries page **after the
real numbers have rendered** (the page loads a skeleton first — wait for
actual dollar figures, not shimmering placeholder bars, or the script will
correctly refuse and tell you why).

```js
(function () {
  const OPTION_LABELS = { TW: 'Two-Way Contract', P: 'Player Option', T: 'Team Option', Q: 'Qualifying Offer' };

  function teamIdFromRow(row) {
    const img = row.querySelector('img');
    if (!img) return '';
    const src = img.currentSrc || img.src || '';
    const m = src.match(/([a-z0-9-]+)\.(svg|png|webp)(\?|$)/i);
    return m ? m[1] : ''; // usually a numeric Gannett/HoopsHype logo ID, not a team code -- see Step 3
  }

  function playerNameFromRow(row) {
    const candidates = [...row.querySelectorAll('a')]
      .map(a => a.textContent.replace(/\s+/g, ' ').trim())
      .filter(t => /[A-Za-z].*[A-Za-z]/.test(t) && t.length > 2);
    return candidates[0] || '';
  }

  // Cell text may render as "P$62,841,702" or "$62,841,702" or "-" -- pull the
  // amount and the option-letter (TW/P/T/Q) independently so DOM order doesn't matter.
  function parseMoneyCell(td) {
    if (!td) return { amount: '', option: '' };
    const raw = td.textContent.replace(/ /g, ' ').trim();
    if (!raw || raw === '-' || raw === '—' || raw === '–') return { amount: '', option: '' };
    const amountMatch = raw.match(/[\d,]{4,}/);
    const amount = amountMatch ? amountMatch[0].replace(/,/g, '') : '';
    const rest = amountMatch ? raw.replace(amountMatch[0], '') : raw;
    const optionMatch = rest.match(/TW|P|T|Q/);
    return { amount, option: optionMatch ? optionMatch[0] : '' };
  }

  const table = [...document.querySelectorAll('table')].find(t => t.querySelector('tbody tr td'));
  if (!table) { console.error('No salary table found — is the page fully loaded?'); return; }

  const headerRow = table.querySelector('thead tr') || table.rows[0];
  const headerCells = [...headerRow.querySelectorAll('th,td')].map(c => c.textContent.trim());
  const yearCols = headerCells
    .map((h, i) => ({ h, i }))
    .filter(x => /^\d{4}-\d{2}$/.test(x.h));

  if (!yearCols.length) {
    console.warn('Could not detect year-column headers — table may still be a loading skeleton.');
    return;
  }

  const out = [];
  for (const row of table.querySelectorAll('tbody tr')) {
    const cells = row.querySelectorAll('td');
    if (!cells.length) continue;
    const player = playerNameFromRow(row);
    if (!player) continue;
    const team = teamIdFromRow(row);

    const amounts = [];
    const notes = [];
    for (const yc of yearCols) {
      const { amount, option } = parseMoneyCell(cells[yc.i]);
      amounts.push(amount);
      if (option && OPTION_LABELS[option]) notes.push(`${OPTION_LABELS[option]} ${yc.h}`);
    }
    const csvName = /,/.test(player) ? `"${player}"` : player;
    out.push([csvName, team, ...amounts, notes.join('; ')].join(','));
  }

  const csv = out.join('\n');
  console.log(csv);
  copy(csv); // Chrome DevTools-only global — copies straight to the clipboard
  console.log(`\n${out.length} players parsed (no header row) — CSV copied to clipboard.`);
})();
```

No header row is emitted, on purpose — this makes it safe to run the script
multiple times (once per page, if the site paginates) and paste the results
one after another without duplicating the header each time.

## Step 2 — decode the team column

The team column comes out as a small number (`2`, `27`, `5312`...), not an
abbreviation — that's the logo image's filename ID, not a team code, and
there is no public ID→team lookup table to hardcode. Decode it by
**cross-referencing against the existing `current.csv`**: for every scraped
player who already has a row in the current file, tally which real team
abbreviation their scraped numeric ID lines up with, then take the majority
team per ID. With a full-roster scrape this converges cleanly (each of the
~30 IDs gets 10-20 votes); do not attempt to decode from a handful of rows.

A weak majority (well under 100%) is *not* automatically evidence of a bad
decode — it's exactly what you'd expect after a real trade-heavy offseason,
since the dissenting votes are players who genuinely changed teams since the
old `current.csv` was written. Cross-check a low-confidence ID against the
handful of unmistakable franchise players in that group (a team's actual
long-tenured star isn't going to be misattributed) before concluding the
decode itself is wrong rather than the trade being real. Don't silently
"fix" a low-confidence mapping — surface it and let the owner confirm.

Two IDs landing on the same real team by majority vote, with a coherent
trade story connecting the dissenting players (e.g. two stars swapping teams
in one package), is a strong signal the decode is *correct*, not broken —
resist the urge to force every ID to a distinct single team.

## Step 3 — resolve name-matching gaps

The scrape often abbreviates a first name to an initial ("G. Antetokounmpo").
Match these against `current.csv` by exact last-name-token + first-initial,
requiring a **unique** candidate — never fall back to fuzzy/edit-distance
matching on last names alone. It looks safe until it silently pairs a 2026
rookie with an unrelated veteran who happens to share a surname and initial
(this has actually happened: "Darryn Peterson" — a rookie — matched a
completely different "Drew Peterson" under a loose fuzzy rule). A handful of
real nickname mismatches (old CSV says "Nic Claxton", scrape says "Nicolas
Claxton"; "Santi Aldama" vs "Santiago Aldama"; "Cam Whitmore" vs "Cameron
Whitmore") need a small hand-verified alias list instead of a fuzzy
algorithm — check each one against the actual roster before adding it.

Anyone who doesn't match by either method is either a genuine new
entrant (rookie, two-way, UDFA — no `salary_current` figure to carry over,
that's correct, not a bug) or a real person the automated match missed.
Spot-check a sample of the "unmatched" list against known current rookies
before assuming it's clean.

## Step 4 — watch for duplicate rows with the same name

Occasionally the same name appears twice with different teams/salaries —
this can mean either a genuine scraping artifact (one row stale/misaligned)
or two different real people who share a name (this happened with
"Julian Champagnie" and "Justin Champagnie" — real twin brothers, not a
duplicate). Never collapse a duplicate automatically. Check:
- Do the two rows' numbers match the *old* `current.csv` closely? That's a
  signal one of them is a stale artifact, not fresh data.
- Is the salary implausible for the apparent player (e.g. $15M for what
  should be a minimum-deal role player)? Likely an artifact.
- Does a second, independent source (the roster CSV, a second scrape pass)
  corroborate one of the two rows? That's the strongest signal.
When genuinely unsure, ask rather than guessing — a wrong pick here either
loses a real player's row entirely or duplicates one and drops another.

## Step 5 — merge, don't replace

A single scrape pass rarely reaches every player in the existing
`current.csv` (deep bench / minimum-salary players tend to fall outside
whatever range got scrolled through). Default to **carrying forward
unchanged** any existing row that wasn't touched by this pass — don't let a
partial refresh silently delete real players from the file. Only truly
replace the whole file when the owner has explicitly said this pass is meant
to supersede everything (and even then, confirm the loss of any specific
players — LeBron, Chris Paul, etc. — before dropping them).

## Step 6 — verify before committing

```bash
npm run nba:salary -- --dry-run
```
Read the unmatched count and the sample unmatched names. A number that looks
much higher than "this pass's genuine new rookies" means something upstream
(usually Step 2 or Step 3) needs a second look before this goes any further.
Only after a clean dry-run: commit `current.csv`, then follow the ordering
in the main SKILL.md (`nba:salary` then `nba:roster`) to get the refresh all
the way to the live team-rosters page.
