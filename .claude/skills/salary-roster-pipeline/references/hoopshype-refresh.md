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

## The current workflow: one team at a time

The owner now pulls HoopsHype's **per-team** salary page (`Team` dropdown,
one franchise at a time — e.g. "Atlanta Hawks Salaries") rather than a single
bulk cross-team table. This is simpler in one important way and needs one
extra step in another:

- **Simpler**: there's no numeric-logo-ID column to decode (see the old
  bulk-table method below) — the team is just whatever the page's dropdown
  says, and the owner already knows it since they navigated there.
- **Extra step**: because you're told the team out of band (by the page,
  not by scraping it), the console script must be pointed at the actual page
  heading to emit the right canonical code, or the resulting CSV rows will
  have a blank team column.

### Step 1 — scrape one team's page

Paste this into DevTools console on the HoopsHype team salaries page **after
the real numbers have rendered** (the page loads a skeleton first — wait for
actual dollar figures, not shimmering placeholder bars, or the script will
correctly refuse and tell you why). It reads the team name straight from the
page's `<h1>` (e.g. "Atlanta Hawks Salaries") and maps it to the canonical
FHE code from `src/lib/nba-teams.ts` — not `PHX`/`NOP`/`GS`-style aliases.

```js
(function () {
  const OPTION_LABELS = { TW: 'Two-Way Contract', P: 'Player Option', T: 'Team Option', Q: 'Qualifying Offer' };

  const TEAM_NAME_TO_ABBR = {
    'atlanta hawks': 'ATL', 'boston celtics': 'BOS', 'charlotte hornets': 'CHA',
    'chicago bulls': 'CHI', 'cleveland cavaliers': 'CLE', 'dallas mavericks': 'DAL',
    'denver nuggets': 'DEN', 'detroit pistons': 'DET', 'golden state warriors': 'GSW',
    'houston rockets': 'HOU', 'indiana pacers': 'IND', 'la clippers': 'LAC',
    'los angeles clippers': 'LAC', 'los angeles lakers': 'LAL', 'memphis grizzlies': 'MEM',
    'miami heat': 'MIA', 'milwaukee bucks': 'MIL', 'minnesota timberwolves': 'MIN',
    'new orleans pelicans': 'NOR', 'new york knicks': 'NYK', 'brooklyn nets': 'BKN',
    'oklahoma city thunder': 'OKC', 'orlando magic': 'ORL', 'philadelphia 76ers': 'PHI',
    'phoenix suns': 'PHO', 'portland trail blazers': 'POR', 'sacramento kings': 'SAC',
    'san antonio spurs': 'SAS', 'toronto raptors': 'TOR', 'utah jazz': 'UTA',
    'washington wizards': 'WAS',
  };

  function currentTeamAbbr() {
    const h1 = document.querySelector('h1');
    const raw = (h1 ? h1.textContent : '').replace(/salaries/i, '').trim().toLowerCase();
    const abbr = TEAM_NAME_TO_ABBR[raw];
    if (!abbr) {
      console.error(`Could not map page title "${h1 ? h1.textContent.trim() : '(no h1 found)'}" to a team code — check TEAM_NAME_TO_ABBR or the h1 selector.`);
      return null;
    }
    return abbr;
  }

  function playerNameFromRow(row) {
    const candidates = [...row.querySelectorAll('a')]
      .map(a => a.textContent.replace(/\s+/g, ' ').trim())
      .filter(t => /[A-Za-z].*[A-Za-z]/.test(t) && t.length > 2);
    return candidates[0] || '';
  }

  function parseMoneyCell(td) {
    if (!td) return { amount: '', option: '' };
    const raw = td.textContent.replace(/ /g, ' ').trim();
    if (!raw || raw === '-' || raw === '—' || raw === '–') return { amount: '', option: '' };
    const amountMatch = raw.match(/[\d,]{4,}/);
    const amount = amountMatch ? amountMatch[0].replace(/,/g, '') : '';
    const rest = amountMatch ? raw.replace(amountMatch[0], '') : raw;
    const optionMatch = rest.match(/TW|P|T|Q/);
    return { amount, option: optionMatch ? optionMatch[0] : '' };
  }

  const team = currentTeamAbbr();
  if (!team) return; // refuse to emit rows with a guessed/blank team code

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
  console.log(`\n${out.length} ${team} players parsed (no header row) — CSV copied to clipboard.`);
})();
```

No header row is emitted, on purpose — safe to run once per team and paste
the results one after another without duplicating a header each time. Each
row this produces has **7 fields**: `name, team, sal1, sal2, sal3, sal4,
note` — up to 4 year-columns, whatever the page actually shows. This matters
a lot for the next section.

### The trap: current.csv's header has a column no pull ever fills

`current.csv`'s header is `player,team,salary_current,salary_y2,salary_y3,
salary_y4,salary_y5,contract_note` — **8 columns** — but the script above
(and the old bulk-table script) only ever emits **7**: it never populates a
`salary_y5`, because no HoopsHype page has ever shown a 5th year. If you
write pulled rows straight into `current.csv` as-is — `cells.join(",")` of
whatever came off the page — every row silently shifts one column left: the
note lands in the `salary_y5` slot, and the real `contract_note` column ends
up empty for every row.

This doesn't show up as an error. `salary_ingest.ts` reads `contract_note`
by column *name*, so it just reads an empty string and moves on — matching
still works fine, the dry-run's numbers still look plausible, and only much
later do you notice that `is_two_way`/`free_agent_status` are wrong for
every single player with a note. This exact bug shipped for real once (an
entire `current.csv` rebuild ran through `npm run nba:salary` before it was
caught). **Before running the real ingest on any rebuilt `current.csv`,
verify column count:**

```bash
awk -F',' '{print NF}' data/nba-salaries/current.csv | sort | uniq -c
```

Every row should show exactly 8 fields. If you're rebuilding programmatically
(e.g. merging many pasted per-team blocks with a script), construct each row
explicitly as `[name, team, sal1, sal2, sal3, sal4, "", note]` — never a bare
join of the pulled tokens — so the blank `salary_y5` placeholder is always
there.

### Legacy method: the bulk cross-team table

Before the per-team workflow, the owner sometimes pulled a single table
listing players across all 30 teams at once. That script is nearly identical
to the one above, except it can't read a team name from an `<h1>` (there
isn't one team per page) — instead it pulls a numeric ID off each row's team
logo `<img src>`, which has to be decoded separately:

**Decoding the team column**: the numeric ID is a logo filename ID, not a
team code, and there's no public ID→team lookup table. Decode it by
cross-referencing against the existing `current.csv`: for every scraped
player who already has a row, tally which real team abbreviation their
numeric ID lines up with, then take the majority team per ID. This only
converges cleanly with a full-roster scrape (each of the ~30 IDs needs
10-20 votes) — don't attempt it from a handful of rows. A weak majority
(well under 100%) isn't automatically evidence of a bad decode — it's
exactly what a trade-heavy offseason looks like, since the dissenting votes
are players who genuinely changed teams. Cross-check a low-confidence ID
against a couple of unmistakable franchise players in that group before
concluding the decode is wrong rather than the trade being real. Never
silently "fix" a low-confidence mapping — surface it and let the owner
confirm. Two IDs landing on the same real team by majority vote, with a
coherent trade story connecting the dissenting players, is a sign the decode
is *correct* — resist forcing every ID to a distinct single team.

Use the per-team method above unless there's a specific reason to pull the
bulk table instead.

## Step 2 — resolve abbreviated first names

HoopsHype often abbreviates a long first name to an initial ("K. Towns" for
Karl-Anthony Towns, "N. Alexander-Walker", "S. Gilgeous-Alexander") — this
happens on a large fraction of players with a hyphenated or multi-syllable
first name, not just a rare edge case. Resolve these by **exact last-name-
token + first-initial matching against the existing `current.csv`, requiring
a unique candidate** — never fall back to fuzzy/edit-distance matching on
last names alone. A loose substring match (e.g. checking whether one name
"ends with" a fragment of the other) produces false positives that look
identical to real matches until you check them by hand — this happened
concretely: a naive substring check matched "D. Finney-Smith" to "Dru Smith"
and "T. Haliburton" to "Tyler Burton", both wrong, both because the check
allowed a suffix-of-a-suffix match instead of requiring the full last-name
token.

A small node script does this well: extract every `X. Lastname`-shaped name
from the new pull, and for each one, search old `current.csv` for entries
where the first token's initial matches and the remaining tokens equal
(exactly, or as a whole-token suffix — not a raw substring) the abbreviated
part. Bucket results into three tiers and handle them differently:

- **Unique match** → auto-apply the expansion, no confirmation needed.
- **Ambiguous** (multiple candidates) → surface all candidates and ask,
  never guess. This is exactly the trap that has bitten this pipeline
  before: "Darryn Peterson" (a rookie) fuzzy-matched to "Drew Peterson" (an
  unrelated veteran) under a looser rule.
- **No candidate at all** → likely a genuine new entrant (rookie, two-way,
  UDFA) with no prior-season row to match against — that's expected, not a
  bug, and it'll surface again as "unmatched" when you dry-run the ingest.

Also watch for known nickname/legal-name pairs that aren't abbreviations but
hit the same class of bug: "Santi Aldama" vs "Santiago Aldama", "Dennis
Schroder" vs "Schroeder", "Cam Whitmore" vs "Cameron Whitmore", "Nic Claxton"
vs "Nicolas Claxton". `src/lib/player-name-aliases.ts` is the canonical list
of these for the DB join layer — when a fresh pull uses the *other* form
than what's already established there, rename it back rather than expanding
the alias file for a single CSV refresh. A dry-run of `salary_ingest.ts`
that shows one of these names as unmatched is the signal to check this list.

## Step 3 — resolve genuine duplicate names across teams

After resolving abbreviations, check for players appearing more than once —
this catches both real bugs and real people that look like bugs:

```bash
awk -F',' 'NR>1 && $1!="" {print $1}' current.csv | sort | uniq -d
```

Cross-reference each hit against the *old* `current.csv`: whichever team's
numbers roll forward cleanly from the old file (this year's `salary_current`
equals last year's `salary_y2`, etc.) is the real, current team; a row whose
numbers don't roll forward from anything is usually the stale one. Real
cases seen in this pipeline, each needing a different resolution:

- **Real twins/same-surname players sharing an ambiguous abbreviated form**:
  "Julian Champagnie" and "Justin Champagnie" both showed up as "J.
  Champagnie" on different teams in one pull. Both were legitimate — the
  fix was expanding each back to its full name (confirmed via which team's
  numbers rolled forward from which old row), not collapsing them.
- **A stale row left over from before a trade**: "O. Prosper" appeared on
  both his old and new team in one pull; the old team's row didn't roll
  forward from anything and was dropped.
- **Genuinely two different real people who happen to share a name**: "Kam
  Jones" showed up on two teams with different salary tiers — this needs
  the owner's direct knowledge (which one is real, which is stale/wrong),
  not an algorithmic guess, since both looked equally plausible from the
  data alone.

Never collapse a duplicate automatically. When genuinely unsure, ask rather
than guessing — a wrong pick either loses a real player's row entirely or
duplicates one and drops another.

## Step 4 — identify dead money masquerading as an active contract

HoopsHype's team pages sometimes carry a player's **stretched dead-cap
hit** on the team that waived him, formatted exactly like a real active
salary row — same columns, same look. Left in `current.csv`, this produces
a phantom "active contract" for a player who isn't actually on that roster.

**Heuristic**: a player with **3 or more identical non-empty year salaries**
is a candidate — a genuinely negotiated multi-year deal almost always has at
least a small raise year over year, so a flat run is a signature of the
stretch provision spreading a fixed dead-money amount evenly. A quick scan:

```bash
awk -F',' '
NR>1 && $1!="" {
  n=0; allSame=1; first=""
  for (i=3;i<=6;i++) {
    if ($i != "") {
      n++
      if (first=="") first=$i
      else if ($i!=first) allSame=0
    }
  }
  if (n>=3 && allSame==1) print $1","$2","n" identical years @ "first
}' current.csv
```

**This heuristic has false positives you must not act on**: a real
designated-rookie max extension is *also* flat by rule (a fixed percentage
of the cap each year) — Jalen Johnson and Dyson Daniels both matched this
exact pattern in one pull and were completely legitimate, active, core
players. The heuristic only tells you where to *look*, not what to
conclude. Confirm every candidate against an independent source (a
dead-money tracker, Spotrac, direct owner knowledge) before treating it as
dead money — see
[references/third-party-cross-check.md](references/third-party-cross-check.md).
Once confirmed as dead money with no real second team, ask the owner
whether the player is retired/out of the league entirely (drop the row) or
has a known real destination (reassign instead of drop) — never assume
either silently.

## Step 5 — check for orphaned rows: real departures, not scrape gaps

A full 30-team pull is comprehensive enough that a player from the *old*
`current.csv` (or the roster CSV) who doesn't appear **anywhere** in the new
pull, under any team, is usually a real departure (retirement, out of the
league) — not evidence the scrape missed them. Diff old names against the
new pull (careful to expand abbreviations first, or this drowns in false
positives from Step 2's issue) to find these. Confirmed real examples this
pipeline has hit: several long-tenured veterans who'd genuinely retired,
each confirmed absent from every one of the 30 fresh team pages.

Don't silently drop these from the roster CSV without asking — the owner
may want a departed player kept on the roster listing (marked UFA in the
`contract` field, team left as their last real team) for continuity rather
than removed outright. Both are valid outcomes; which one depends on how the
owner wants the roster page to read, not on the data alone.

## Step 6 — merge, don't replace (unless it's a genuine full rebuild)

A single team-by-team pass, done one team at a time over multiple sessions,
naturally covers the whole league eventually — but a partial pull (only some
teams pulled so far) should default to **carrying forward unchanged** any
existing row the pass hasn't reached yet, not deleting it. Only treat a pass
as a full replacement when the owner has explicitly said this covers every
team and is meant to supersede the whole file — and even then, confirm the
loss of any specific notable players before dropping them, since a stale
partial pull masquerading as complete would otherwise delete real people
silently.

## Step 7 — verify before committing

```bash
npm run nba:salary -- --dry-run
```

Read the unmatched count and the sample unmatched names — a number much
higher than "this pass's genuine new rookies" means Step 2 or Step 3 needs
another look. **Also re-check column alignment** (the `awk NF` command from
the trap above) even if the dry-run output looks clean — the misalignment
bug doesn't affect match counts, only the note-derived fields, so a clean
dry-run is not proof the file is structurally sound. Only after both checks
pass: commit `current.csv`, then follow the ordering in the main SKILL.md
(`nba:salary` then `nba:roster`) to get the refresh all the way to the live
team-rosters page.
