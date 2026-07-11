# Trend-Tag System — Rules & Player-Pool Audit (2025-26 season, Minus1V)

*Generated 2026-07-11 from live `nba_player_trends` + `season_player_values` data, reproducing `deriveFinalTake()` exactly as `/team-rosters` runs it (default metric: Minus1V, league size 400).*

---

## Part 1 — The rules that assign trend tags

### 1.1 The inputs

Every rostered player with a trends payload (437 of 579 roster rows; the display filter is **>10 GP and >10 MPG** in `build-player-trends.ts`) gets a tag per metric from `deriveFinalTake()` in `trend-insight.ts`. The card shows the **Minus1V** tag by default. Inputs:

- **`cumRank` series** — 12 two-week blocks; at each block the player's *expanding season-to-date* per-game line is re-scored against the frozen 400-player pool and ranked among all display-eligible players. Blocks with <2 games are **stale** (carry forward the last fresh value).
- **Chart window** — the trailing **10 blocks** (`LOOKBACK_BLOCKS`). `startRank` = first non-null cumRank in the window, `nowRank` = last.
- **`consensusRank`** — the dynasty consensus from `dynasty-rankings.json`, joined by normalized name, **falling back to 999 when the player isn't in the list**.
- **`age`** — from `nba_roster.dob`, else `age_at_ingest`, else the dynasty row.
- **`seasonHistory`** — up to 3 seasons (2024/2025/2026) of already-computed season values.

Derived quantities: `gapNow = nowRank − consensusRank` (positive = producing **below** consensus) and `trend = startRank − nowRank` (positive = improved over the window).

### 1.2 The two override gates (checked first)

1. **INJURY-LIMITED** — if stale blocks ÷ elapsed blocks ≥ **0.35** (`INJURY_STALE_SHARE`), the tag is `injury-limited` regardless of direction. Blurb: "Missed significant time this season (X of Y blocks)…".
2. **AGE DECLINE** — if age ≥ **30**, and Minus1V declined across **every** "healthy" season (GP ≥ 50) in the history, and the player is neither elite by consensus (≤ 25) nor still producing top-60 now, the tag is `aging-decline`. Minutes are cited only if the most recent healthy-season drop is ≥ 5.0 MPG.

### 1.3 The core decision tree (when no gate fires)

Thresholds: `FLOOR = 10`, `SMALL_GAP = 20`, `HEAVY = 40`, `FAR_GAP = 60` (all in rank spots).

| Position vs consensus | Window trend | Tag |
|---|---|---|
| gapNow < −20 (outproducing) | trend ≤ −10 | **REGRESSING** |
| gapNow < −20 | otherwise | **SURGING** (includes flat "holding") |
| gapNow > +20 (underproducing) | trend ≥ +10 | **CLIMBING** |
| gapNow > +60 AND trend ≤ −40 | | **CRATERING** |
| gapNow > +20 | otherwise | **FADING** (includes flat) |
| −20 ≤ gapNow ≤ +20 (near) | trend ≥ +40 | **BREAKING OUT** |
| near | trend ≤ −40 | **PLUNGING** |
| near | otherwise | **STABLE** |

A **postseason rider** is appended to the blurb when the player has ≥ 4 playoff games and his playoff value differs from his regular-season value by ≥ 0.30 z (up or down).

### 1.4 What the tag actually measures (and doesn't)

The trend is **first-to-last of the cumulative season-average rank** over ~20 weeks. Three structural consequences drive most of the findings below:

- **Start-point noise.** The window's start rank is a season-average over only ~3 blocks of games. A player with 4–9 games by then can start at an absurd rank (Coby White's cumRank was **#3** after his first game back), manufacturing huge "moves."
- **End-point stickiness + absence masking.** Late-season, the cumulative average barely moves — and a player who stops playing keeps his carried rank drifting slowly as others pass him. Directional tags ("holding", "closing the gap") keep firing for players who haven't played in 6+ weeks, as long as they stay below the 0.35 stale share. **Eleven sampled players sit at exactly 4/12 = 0.333 stale — one block under the gate.**
- **Endpoint-only judgment.** A V-shape (or hot start that normalizes) is judged by its endpoints; "collapsed/crashed" copy often describes convergence *to* consensus, not below it.

### 1.5 Tag population (Minus1V, full pool of 374 tagged players)

| Tag | Count | Sampled |
|---|---|---|
| regressing | 68 | 25 |
| surging | 66 | 25 |
| stable | 64 | 25 |
| injury-limited | 59 | 25 |
| fading | 31 | 25 |
| aging-decline | 25 | 25 |
| climbing | 21 | 21 |
| plunging | 17 | 17 |
| cratering | 12 | 12 |
| breaking-out | 11 | 11 |

**45 of the 374 tagged players carry the fallback consensus of 999** — every one of their gap-based tags (and any blurb citing "#999 consensus rank") is invalid on its face.

### 1.6 Methodology notes for the per-player reviews

- **Playoff rank** = 2026-postseason cumulative Minus1V rank among all 240 postseason value rows; cited only when the player logged **≥ 6 playoff games at > 10 MPG** (your gate). Below the gate it's marked n/a.
- **Prior-season ranks** = Minus1V rank within that season's full `season_player_values` feed (580 rows in 2024, 574 in 2025) — slightly wider pools than the 437-player 2026 trend pool, so treat ±15 spots as noise when comparing across seasons.
- Confidence scale: **High** (keep, no caveats) / **Medium** (keep, caveat noted) / **Low** (recommend a different tag — collected in Part 3).

---

## Part 2 — Per-player reviews by tag

### REGRESSING (sampled 25 of 68)

**Julius Randle (BKN) · cons #91 · age 32 · 79 GP** — window #35→#64 (−29)
Concerns: none — fully sampled (0 stale), steady drift off a top-40 start. Confidence: **High**.
Playoffs 26: **#104** (12 GP, 33.2 MPG) — confirms the fade; the blurb's downward playoff rider is earned. Blurb: accurate, keep.
Prior: 2024 46 GP · #75 | 2025 69 GP · #91. Cross-season: 75→91→64 — 2026 was actually his best cumulative finish of the three; the regression is within-season, off an unsustainable start.
Vs consensus: still 27 spots ahead of #91 and converging — the market rank looks about right.

**Josh Hart (NYK) · cons #125 · age 31 · 66 GP** — window #84→#104 (−20)
Concerns: the window hides a full arc (cold #240 start pre-window, mid-season peak #56, late fade); 8-cat disagrees (surging) because FT% is his drop cat. Confidence: **Medium** — keep, but the card contradicts itself: tag says down, playoff rider says up.
Playoffs 26: **#54** (19 GP, 32.3 MPG) — a full tier above his season line.
Blurb: technically accurate but the "sliding back toward it" + "clearly better in playoffs" pairing is confusing; suggest leading with the playoff form: "A down regular season (#104 vs #43 last year), but 19 playoff games at a top-55 level say the engine is fine."
Prior: 2024 81 GP · #143 | 2025 77 GP · #43. Cross-season: 143→43→104 — one outlier career year; 2026 landed between his two prior seasons.
Vs consensus: at #104 vs cons #125 he still outproduces his market rank even in a down year.

**Ryan Kalkbrenner (CHA) · cons #149 · age 24 · 69 GP** — window #51→#117 (−66)
Concerns: rookie; start #51 was a genuinely strong first ~25 games, not a sample artifact — the league adjusted. Confidence: **High**.
Playoffs 26: n/a. Blurb: fine; "off ~66 spots" is real.
Prior: none (rookie). Cross-season: n/a.
Vs consensus: even faded, #117 beats his #149 consensus — a rookie big outproducing his market rank is a quiet buy signal, which "REGRESSING" doesn't convey. Consider blurb tweak noting he still sits above consensus.

**Isaiah Stewart (MEM) · cons #177 · age 25 · 58 GP** — window #101→#129 (−28)
Concerns: last four blocks are thin (0/4/3/3 games) — the late drift is part absence, not just form. Confidence: **Medium**.
Playoffs 26: **#119** (14 GP, 11.8 MPG) — matches the season line.
Blurb: acceptable; could acknowledge the limited late-season run.
Prior: 2024 46 GP · #162 | 2025 72 GP · #167. Cross-season: 162→167→129 — 2026 is his best value season; the within-window fade is off a career-best start.
Vs consensus: 48 spots ahead of #177 — market is behind on him even after the fade.

**Naji Marshall (DAL) · cons #198 · age 28 · 74 GP** — window #150→#166 (−16)
Concerns: none material; mild, well-sampled drift. Confidence: **High**.
Playoffs 26: n/a. Blurb: fine.
Prior: 2024 64 GP · #291 | 2025 69 GP · #158. Cross-season: 291→158→166 — established a new level in 2025 and held it.
Vs consensus: steady ~30 spots above consensus; "regressing" is technically right but he's simply settling at his real level.

**Kelly Oubre Jr. (IND) · cons #229 · age 31 · 50 GP** — window #89→#132 (−43)
Concerns: 4/12 stale (blocks 3–5 missed entirely) — one block under the injury gate; the #89 start predates the injury. Confidence: **Medium** — the decline is partly an availability story.
Playoffs 26: **#87** (11 GP, 33.2 MPG) — clearly better than his season finish.
Blurb: should mention the missed month; suggest: "Missed a month early, and the post-injury level (~#130) sits below his hot start — but 11 playoff games at a top-90 level point back up."
Prior: 2024 68 GP · #148 | 2025 60 GP · #110. Cross-season: 148→110→132 — stable veteran band, no cliff.
Vs consensus: ~97 spots ahead of a #229 consensus that looks too pessimistic.

**Goga Bitadze (ORL) · cons #259 · age 27 · 64 GP** — window #131→#195 (−64)
Concerns: blocks 7–8 nearly empty (2/1 games) accelerate the printed slide. Confidence: **Medium**.
Playoffs 26: **#97** (6 GP, 13.8 MPG) — sharply better than his season line in a short burst.
Blurb: fine, but the playoff rider is absent despite a qualifying 6-game sample — the +0.3 z jump check may just miss; worth confirming.
Prior: 2024 62 GP · #205 | 2025 70 GP · #126. Cross-season: 205→126→195 — value tracks his minutes yo-yo; role-driven, not skill-driven.
Vs consensus: still 64 ahead of #259; a bench big whose value is entirely rotation-dependent.

**Isaiah Jackson (LAC) · cons #277 · age 24 · 55 GP** — window #161→#238 (−77)
Concerns: several thin blocks (0/2/2 games); the finish itself is a 2-game block. Confidence: **Medium**.
Playoffs 26: n/a. Blurb: fine.
Prior: 2024 60 GP · #188 | 2025 5 GP · #173 (5-game sample — ignore). Cross-season: healthy-year baseline ~#190; 2026's #238 is a genuine step down.
Vs consensus: still 39 ahead of #277 — fair tag, correct direction.

**Isaiah Joe (DET) · cons #284 · age 27 · 71 GP** — window #143→#182 (−39)
Concerns: his pre-window cumRank was #65 off a 2-game season opener — the #143 start is already inflated by that hot open; his stable level is ~180–220. Confidence: **Medium** — printed move overstates the change.
Playoffs 26: **#126** (13 GP, 11.0 MPG) — modestly better than his season line.
Blurb: replace "trending down — off ~39 spots" with something closer to "settled at his usual mid-100s/200 level after a hot shooting start."
Prior: 2024 78 GP · #231 | 2025 74 GP · #211. Cross-season: 231→211→182 — actually a three-year *improvement* trend; the within-season read and the multi-season read point opposite ways.
Vs consensus: ~100 spots ahead of #284 — market rank is stale.

**Kevin Huerter (DET) · cons #296 · age 28 · 69 GP** — window #169→#225 (−56)
Concerns: start rank rode an excellent opening month (cum #95 at block 0). Confidence: **Medium-High**.
Playoffs 26: n/a (5 GP, 9.0 MPG). Blurb: fine.
Prior: 2024 64 GP · #195 | 2025 69 GP · #225. Cross-season: 195→225→225 — he finished exactly at his established level; the "regression" is the hot start washing out.
Vs consensus: 71 ahead of #296; tag right, story is normalization.

**Marcus Smart (HOU) · cons #303 · age 32 · 62 GP** — window #164→#189 (−25)
Concerns: none in the data; the problem is the consensus input — #303 for a 62-game starter producing #189 is badly stale. Confidence: **Medium** (tag mechanically right, anchored to a wrong consensus).
Playoffs 26: **#30** (10 GP, 34.5 MPG) — elite playoff run, and the blurb has no rider for it; that's a miss worth checking (10 GP qualifies).
Blurb: rewrite to note the playoff surge; as printed it reads bearish on a player whose most recent form was top-30.
Prior: 2024 21 GP · #77 | 2025 34 GP · #278 (both partial seasons). Cross-season: injury-noisy; 2026 was his healthiest year in three.
Vs consensus: 114 spots ahead — flag his consensus rank for review rather than the tag.

**Jordan Walsh (BOS) · cons #307 · age 22 · 68 GP** — window #209→#273 (−64)
Concerns: window start sits just after a #114 spike (block 3) built on ~20 games of hot 3PT shooting — his real level is the 250–275 he finished at. Confidence: **Medium**.
Playoffs 26: **#161** (7 GP, 12.7 MPG) — better than his season line, small role.
Blurb: fine directionally; "off ~64 spots" overstates a normalization.
Prior: 2024 9 GP · #417 | 2025 52 GP · #511. Cross-season: 417→511→273 — a large real step forward in year 3; season-long trend is up even though the window reads down.
Vs consensus: 34 ahead of #307 — a young player outproducing consensus while tagged REGRESSING is the endpoint-window artifact in miniature.

**Will Richard (GSW) · cons #312 · age 24 · 69 GP** — window #215→#276 (−61)
Concerns: rookie; strong first two months (#179–#215), then the rank decayed as his shooting cooled. Confidence: **Medium-High**.
Playoffs 26: n/a. Blurb: fine.
Prior: none (rookie). Cross-season: n/a.
Vs consensus: finished 36 ahead of #312 — solid rookie value either way.

**Dominick Barlow (PHI) · cons #323 · age 23 · 71 GP** — window #159→#208 (−49)
Concerns: none serious — well-sampled. Confidence: **Medium-High**.
Playoffs 26: **#130** (9 GP, 10.8 MPG) — a touch above his season line.
Blurb: technically right, tonally wrong — this was a career year. Suggest: "A career season (#208 vs #396 last year) that peaked mid-year; he's given back ~49 spots since but still sits 115 ahead of consensus."
Prior: 2024 33 GP · #349 | 2025 35 GP · #396. Cross-season: 349→396→208 — breakout year, cooling late.
Vs consensus: 115 spots ahead of #323 — consensus hasn't caught up to the breakout.

**Jose Alvarado (NYK) · cons #332 · age 28 · 69 GP** — window #222→#284 (−62)
Concerns: none — genuine second-half fade. Confidence: **High**.
Playoffs 26: n/a (18 GP but 9.5 MPG — under your minutes bar).
Blurb: fine.
Prior: 2024 56 GP · #251 | 2025 56 GP · #154. Cross-season: 251→154→284 — worst of his three seasons after a career 2025.
Vs consensus: 48 ahead of #332; tag and direction fair.

**Craig Porter Jr. (CLE) · cons #350 · age 26 · 64 GP** — window #211→#261 (−50)
Concerns: minor thin blocks late (2/1 games). Confidence: **Medium-High**.
Playoffs 26: n/a (7 GP, 3.0 MPG). Blurb: fine.
Prior: 2024 51 GP · #361 | 2025 51 GP · #437. Cross-season: 361→437→261 — 2026 is a clear career-best despite the late drift.
Vs consensus: 89 ahead of #350 — same "career year tagged as decline" tonal issue as Barlow.

**Svi Mykhailiuk (UTA) · cons #369 · age 29 · 51 GP** — window #219→#267 (−48)
Concerns: barely played after block 7 (2/2/0/2 games) — the finish is mostly carried rank decaying while idle. Confidence: **Medium-Low** — the printed slide is availability, not form.
Playoffs 26: n/a. Blurb: misleading as written; should note the empty late-season sample.
Prior: 2024 41 GP · #416 | 2025 38 GP · #366. Cross-season: 416→366→267 — mildly improving journeyman.
Vs consensus: 102 ahead of #369 — fringe player, low stakes; a trailing-absence caveat (Part 3, rule change C) would fix this class.

**Caleb Love (PHI) · cons #376 · age 25 · 49 GP** — window #305→#338 (−33)
Concerns: 3/12 stale and blocks 8–10 nearly empty (1/0/0) — same trailing-absence decay as Mykhailiuk. Confidence: **Medium-Low**.
Playoffs 26: n/a. Blurb: same caveat needed.
Prior: none (rookie). Cross-season: n/a.
Vs consensus: 38 ahead of #376 — low-stakes fringe designation.

**Nae'Qwan Tomlin (CLE) · cons #388 · age 26 · 64 GP** — window #206→#322 (−116)
Concerns: the #206 start (block 2) trails a #148 cum built on 13 early games of hot play — the −116 print is roughly double his true change; his stable level is ~270–320. Confidence: **Medium** — direction right, magnitude inflated.
Playoffs 26: n/a (2.7 MPG). Blurb: soften the number or anchor to "settled near #300 after a hot October."
Prior: 2025 5 GP · #430 (ignore). Cross-season: effectively his first real season — and a decent one for a two-way-type.
Vs consensus: 66 ahead of #388.

**Patrick Williams (CHI) · cons #414 · age 25 · 72 GP** — window #298→#345 (−47)
Concerns: none — the full-season path (170→345) is a continuous, well-sampled decline; the window actually *understates* it. Confidence: **High**.
Playoffs 26: n/a. Blurb: fine.
Prior: 2024 43 GP · #193 | 2025 63 GP · #289. Cross-season: 193→289→345 — three straight down years; if he were 30 this would be the aging-decline shape.
Vs consensus: 69 ahead of #414, but the trajectory is the story here.

**Keaton Wallace (ATL) · cons #999 (fallback) · age 27 · 54 GP** — window #300→#419 (−119)
Concerns: **invalid consensus** — he isn't in the dynasty list, so the tag and the blurb ("outproducing his #999 consensus rank") are meaningless, and the card prints "#999" to users. Confidence: **Low → suppress tag** (systemic fix A).
Playoffs 26: n/a. Prior: 2025 31 GP · #314. Cross-season: fringe guard trending down.

**Quenton Jackson (IND) · cons #999 (fallback) · age 28 · 49 GP** — window #177→#315 (−138)
Concerns: invalid consensus, plus 4/12 stale and a #177 start off ~5 early games. Confidence: **Low → suppress tag**.
Playoffs 26: n/a. Prior: 2024 3 GP · #430 (ignore) | 2025 28 GP · #349. Cross-season: fringe; 2026 mid-season run was his best stretch.

**Kris Murray (MEM) · cons #999 (fallback) · age 26 · 57 GP** — window #278→#305 (−27)
Concerns: invalid consensus. Confidence: **Low → suppress tag**.
Playoffs 26: n/a. Prior: 2024 62 GP · #334 | 2025 69 GP · #485. Cross-season: 334→485→305 — 2026 was actually his best season.

**Kenrich Williams (OKC) · cons #999 (fallback) · age 32 · 56 GP** — window #316→#366 (−50)
Concerns: invalid consensus; also 8-cat says surging — per-metric whiplash on a fringe vet. Confidence: **Low → suppress tag**.
Playoffs 26: n/a (11 GP, 6.6 MPG). Prior: 2024 69 GP · #338 | 2025 69 GP · #330. Cross-season: flat then down; age-appropriate fade.

**Jabari Walker (PHI) · cons #999 (fallback) · age 24 · 64 GP** — window #327→#407 (−80)
Concerns: invalid consensus. Confidence: **Low → suppress tag**.
Playoffs 26: n/a (6 GP, 4.8 MPG). Prior: 2024 72 GP · #257 | 2025 60 GP · #390. Cross-season: 257→390→407 — three-year slide out of the rotation.

**Regressing — group verdict.** The tag is mechanically sound and mostly correct for veterans with full samples (Randle, Huerter, Patrick Williams). Two recurring distortions: (1) hot-start normalization printed as decline (Joe, Tomlin, Walsh, Barlow — often career-best seasons reading as bad news), and (2) the five consensus-999 players, where the tag shouldn't exist at all.

### AGING-DECLINE (sampled 25 of 25 — full population)

**Myles Turner (MIL) · cons #104 · age 30 · 71 GP** — window #69→#107 (flat tag, no arrow)
Concerns: the trigger is paper-thin — his Minus1V was 0.68 → 0.68 → 0.35; the 2024→2025 "decline" is smaller than rounding. He's also exactly at the minimum age (30), and both other metrics read **stable**. Confidence: **Low → recommend STABLE** (and an epsilon on the decline check — systemic fix F).
Playoffs 26: n/a. Blurb: "declined every healthy season since 2023-24" is factually misleading given the flat 2024→2025 step.
Prior: 2024 77 GP · #55 | 2025 72 GP · #62. Cross-season: 55→62→107 — one genuinely down year, not a multi-year slide.
Vs consensus: producing #107 vs cons #104 — dead on the market's read; that's the definition of STABLE.

**DeMar DeRozan (SAC) · cons #164 · age 37 · 77 GP** — window #64→#76
Concerns: none — this is the tag's canonical case (cited in the code comments). Confidence: **High**.
Playoffs 26: n/a. Blurb: fine.
Prior: 2024 79 GP · #38 | 2025 77 GP · #80. Cross-season: 38→80→76 — off his peak, declining gently, still durable.
Vs consensus: producing 88 spots *above* his #164 consensus — the tag suppresses that; worth a blurb line ("still comfortably outproducing his market rank while the multi-year arrow points down").

**CJ McCollum (ATL) · cons #194 · age 35 · 76 GP** — window #132→#137
Concerns: none. Confidence: **High**.
Playoffs 26: **#79** (6 GP, 32.0 MPG) — raised his level in a short run.
Blurb: fine; a playoff rider would be fair here.
Prior: 2024 66 GP · #50 | 2025 56 GP · #120. Cross-season: 50→120→137 — textbook aging curve.
Vs consensus: ~57 ahead of #194; declining but still market-beating.

**Tobias Harris (SAS) · cons #208 · age 34 · 63 GP** — window #149→#143
Concerns: none on the multi-season read. Confidence: **High**, with the playoff tension noted.
Playoffs 26: **#38** (14 GP, 34.6 MPG) — outstanding, and the blurb's upward rider correctly captures it.
Blurb: good — the honest "declining, but playoffs said otherwise" pairing is exactly what the rider is for.
Prior: 2024 69 GP · #61 | 2025 73 GP · #102. Cross-season: 61→102→143 — clean stepwise decline.
Vs consensus: 65 ahead of #208.

**Jerami Grant (MEM) · cons #219 · age 32 · 57 GP** — window #108→#145
Concerns: 2025 (47 GP) is excluded by the healthy-season filter, so the "every healthy season" claim spans just 2024→2026; his 2025 value actually ticked *up*. Confidence: **Medium**.
Playoffs 26: n/a (5 GP). Blurb: technically right under the filter; reads stronger than the evidence.
Prior: 2024 54 GP · #113 | 2025 47 GP · #106. Cross-season: 113→106→145 — down year at 32 after two flat ones; watch rather than declare.
Vs consensus: 74 ahead of #219.

**Draymond Green (GSW) · cons #226 · age 36 · 68 GP** — window #178→#176
Concerns: none. Confidence: **High**.
Playoffs 26: n/a. Blurb: fine.
Prior: 2024 55 GP · #95 | 2025 68 GP · #103. Cross-season: 95→103→176 — real step down this year at 36.
Vs consensus: still 50 ahead of #226.

**Bobby Portis (MIA) · cons #281 · age 31 · 67 GP** — window #230→#165 (**improved +65 in-window**)
Concerns: the multi-season line declines (0.33→0.29→0.14) but his current season *improved all year* and he finished 116 spots above consensus — the tag tells the opposite story from the chart it sits on. Confidence: **Medium → keep only with an in-season rider**, else REGRESSING/SURGING territory.
Playoffs 26: n/a. Blurb: add "though he closed this season strong (#230→#165 over the window)."
Prior: 2024 82 GP · #119 | 2025 49 GP · #118. Cross-season: 119→118→165 — one down year, modest slope.
Vs consensus: 116 ahead of #281 — the most bullish "aging-decline" card in the set.

**Jusuf Nurkic (UTA) · cons #287 · age 32 · 42 GP** — window #167→#99 (**improved +68**)
Concerns: multiple. His 2026 (42 GP) is excluded by the healthy filter, so the tag rests on 2024→2025 — but 2026 *rebounded* sharply (−0.03 → 0.36). The blurb says "minutes down ~6.5/game **this year**" while citing 2023-24 → 2024-25 — factually mislabeled. And he didn't play at all after block 8 (0/0/0). Confidence: **Low → recommend INJURY-LIMITED** (trailing absence) — the aging read is stale and the blurb is wrong.
Playoffs 26: n/a. Prior: 2024 76 GP · #89 | 2025 51 GP · #226. Cross-season: 89→226→99 — V-shaped, not monotone decline.
Vs consensus: produced 188 spots above #287 when he played.

**Alex Caruso (OKC) · cons #290 · age 32 · 56 GP** — window #193→#254
Concerns: none on the regular-season read. Confidence: **Medium-High**.
Playoffs 26: **#63** (15 GP, 23.3 MPG) — massive playoff riser; the blurb's upward rider covers it.
Blurb: good as written.
Prior: 2024 71 GP · #71 | 2025 54 GP · #132. Cross-season: 71→132→254 — steep three-year regular-season slide; he's become a playoff-only asset.
Vs consensus: 36 ahead of #290.

**Luke Kennard (PHX) · cons #292 · age 30 · 79 GP** — window #234→#229
Concerns: minimum age (30), and the year-to-year declines are tiny (0.10→0.04→−0.01) — the epsilon problem again. He played 79 games and held his window rank. Confidence: **Low → recommend SURGING** (the tree's read: outproducing #292 at #229, holding).
Playoffs 26: **#81** (10 GP, 32.5 MPG) — stepped up when the minutes came.
Blurb: "declined every healthy season" over drops of ~0.05 z reads alarmist for a durable 30-year-old.
Prior: 2024 39 GP · #177 | 2025 65 GP · #201. Cross-season: 177→201→229 — gentle drift, not a cliff.
Vs consensus: 63 ahead of #292.

**Dennis Schroder (CLE) · cons #301 · age 33 · 70 GP** — window #188→#269
Concerns: none. Confidence: **High**.
Playoffs 26: **#146** (17 GP, 15.8 MPG) — roughly his season level.
Blurb: fine.
Prior: 2024 80 GP · #150 | 2025 75 GP · #183. Cross-season: 150→183→269 — accelerating decline at 33.
Vs consensus: 32 ahead of #301 — consensus has this one about right.

**Al Horford (GSW) · cons #320 · age 40 · 45 GP** — window #181→#147 (**improved +34**)
Concerns: same shape as Portis — multi-year decline, but the current season improved and he's 173 spots above consensus. At 40 the aging read is obviously credible; the card just shouldn't hide the in-season direction. Confidence: **Medium** — keep with rider.
Playoffs 26: n/a. Blurb: add the in-season improvement.
Prior: 2024 65 GP · #106 | 2025 59 GP · #135. Cross-season: 106→135→147 — remarkably gentle slope for his age.
Vs consensus: 173 ahead of #320.

**Andre Drummond (NYK) · cons #356 · age 33 · 63 GP** — window #133→#233
Concerns: his 2025 (40 GP) is excluded, so "every healthy season" is really 2024→2026 — and 2026 (−0.03) actually *improved* on 2025 (−0.13). The 9-cat metric reads regressing. Confidence: **Low → recommend REGRESSING** (above consensus, trending down in-window; the multi-year story is mixed, not monotone).
Playoffs 26: **#124** (11 GP, 12.8 MPG).
Prior: 2024 79 GP · #166 | 2025 40 GP · #268. Cross-season: 166→268→233 — down, partial rebound.
Vs consensus: 123 ahead of #356.

**Caris LeVert (DET) · cons #378 · age 32 · 60 GP** — window #274→#321
Concerns: none — value and minutes down three straight years. Confidence: **High**.
Playoffs 26: **#109** (13 GP, 16.7 MPG) — big playoff step up worth a rider; the blurb has none (13 GP qualifies — check why).
Prior: 2024 68 GP · #131 | 2025 64 GP · #184. Cross-season: 131→184→321 — steep, consistent.
Vs consensus: 57 ahead of #378.

**Klay Thompson (DAL) · cons #383 · age 36 · 69 GP** — window #243→#263
Concerns: none. Confidence: **High**. Playoffs 26: n/a.
Blurb: fine, minutes trail is accurate (29.6→27.4→21.7).
Prior: 2024 77 GP · #105 | 2025 72 GP · #142. Cross-season: 105→142→263 — classic late-career fade.
Vs consensus: 120 ahead of #383.

**Brook Lopez (LAC) · cons #385 · age 38 · 75 GP** — window #283→#209 (**improved +74**)
Concerns: the Portis/Horford shape once more — steep multi-year decline (48→69→209) but a strong second half this season. Confidence: **Medium** — keep with in-season rider.
Playoffs 26: n/a. Blurb: add the second-half recovery.
Prior: 2024 79 GP · #48 | 2025 81 GP · #69. Cross-season: 48→69→209 — the real cliff came this year.
Vs consensus: 176 ahead of #385.

**Mike Conley (BOS) · cons #391 · age 39 · 54 GP** — window #239→#326
Concerns: 3/12 stale mid-season. Confidence: **High** (at 39, with minutes down 6.3/game, this is what the tag is for).
Playoffs 26: **#106** (12 GP, 14.1 MPG) — genuine playoff lift; the upward rider is present and correct.
Prior: 2024 76 GP · #85 | 2025 71 GP · #164. Cross-season: 85→164→326 — steep, monotone.
Vs consensus: 65 ahead of #391.

**Jonas Valanciunas (DEN) · cons #401 · age 34 · 65 GP** — window #229→#259
Concerns: none. Confidence: **High**. Playoffs 26: n/a (4 GP).
Prior: 2024 82 GP · #111 | 2025 81 GP · #137. Cross-season: 111→137→259 — minutes crushed to 13.4, value followed.
Vs consensus: 142 ahead of #401.

**Terance Mann (BKN) · cons #412 · age 30 · 63 GP** — window #228→#313
Concerns: minimum age, and the latest "decline" step is −0.23 → −0.25 — noise-level (epsilon problem). The 8-cat metric reads regressing. Confidence: **Low → recommend REGRESSING** (above consensus, sliding in-window — that's the real story).
Playoffs 26: n/a. Prior: 2024 75 GP · #232 | 2025 67 GP · #317. Cross-season: 232→317→313 — flat-to-down at a low level.
Vs consensus: 99 ahead of #412.

**Clint Capela (HOU) · cons #435 · age 32 · 75 GP** — window #265→#324
Concerns: none. Confidence: **High**. Playoffs 26: n/a (4 GP).
Prior: 2024 73 GP · #76 | 2025 55 GP · #157. Cross-season: 76→157→324 — among the steepest declines in the pool; minutes halved in two years.
Vs consensus: 111 ahead of #435 (consensus already prices the collapse).

**Buddy Hield (ATL) · cons #436 · age 34 · 51 GP** — window #292→#323
Concerns: barely played blocks 8–9 (0/0). Confidence: **Medium-High**.
Playoffs 26: n/a (2 GP). Prior: 2024 84 GP · #138 | 2025 82 GP · #213. Cross-season: 138→213→323 — clean decline; the tag fits.
Vs consensus: 113 ahead of #436.

**Kentavious Caldwell-Pope (MEM) · cons #445 · age 33 · 51 GP** — window #273→#294
Concerns: 4/12 stale with blocks 9–11 empty (0/0/0) — another trailing-absence case sitting one block under the injury gate. The multi-season decline (116→170→294) is real, so the tag survives, but the finish is idle-drift. Confidence: **Medium**.
Playoffs 26: n/a. Prior: 2024 76 GP · #116 | 2025 77 GP · #170. Cross-season: monotone decline; fits.
Vs consensus: 151 ahead of #445.

**Dorian Finney-Smith (CHA) · cons #999 (fallback) · age 33 · 37 GP** — window #344→#423
Concerns: missed the first four blocks entirely (4/12 stale — under the gate again), 37 GP season, and no valid consensus. The aging read rests on 2024→2025 values of 0.06→0.00 — epsilon-thin. Confidence: **Low → recommend INJURY-LIMITED**.
Playoffs 26: n/a (4 GP). Prior: 2024 68 GP · #190 | 2025 63 GP · #215. Cross-season: gentle drift, then an injury-wrecked 2026 — absence is the story, not aging.

**Caleb Martin (DAL) · cons #999 (fallback) · age 31 · 58 GP** — window #361→#402
Concerns: no valid consensus (aging tag itself doesn't need it, so the tag stands); blurb's minutes trail correctly skips excluded 2025. Confidence: **Medium-High**.
Playoffs 26: n/a. Prior: 2024 64 GP · #227 | 2025 45 GP · #298. Cross-season: 227→298→402 — fringe vet sliding out of relevance; fits.

**Kyle Anderson (TOR) · cons #999 (fallback) · age 33 · 43 GP** — window #203→#214
Concerns: 2026 (43 GP) is excluded from the healthy set, and it *rebounded* (−0.15 → +0.01); the tag is built entirely on 2024→2025. Blurb cites a minutes drop "this year" that's actually 2024-25's. Confidence: **Low → recommend STABLE or no tag** (consensus also missing).
Playoffs 26: n/a (8 GP, 7.5 MPG). Prior: 2024 79 GP · #219 | 2025 61 GP · #276. Cross-season: down then partial recovery — mislabeled by the current blurb.

**Aging-decline — group verdict.** For genuinely old, monotone decliners (DeRozan, Conley, Klay, Capela, Lopez, Valanciunas) the tag is excellent. Three defects recur: (1) **no epsilon** — hair-thin declines trigger it (Turner, Kennard, Mann, DFS); (2) **the healthy-season filter can exclude the current season**, so a live rebound gets ignored and "this year" in the blurb points at last year (Nurkic, Anderson, Drummond); (3) **in-window improvers** (Portis, Horford, Lopez, Nurkic) show a decline story over a chart that visibly rises.

### STABLE (sampled 25 of 64)

**Victor Wembanyama (SAS) · cons #1 · age 23 · 64 GP** — window #2→#2
Concerns: none (two mid-season stale blocks, irrelevant at his level). Confidence: **High**.
Playoffs 26: **#1** (22 GP, 34.1 MPG) — the best playoff producer in the pool.
Blurb: fine; could earn an upward playoff rider given #1 across 22 games.
Prior: 2024 71 GP · #6 | 2025 45 GP · #2. Cross-season: 6→2→2 — ascended, now the ceiling.
Vs consensus: #2 production vs #1 consensus — perfect agreement.

**Nikola Jokic (DEN) · cons #4 · age 31 · 65 GP** — window #1→#1
Concerns: none. Confidence: **High**. Playoffs 26: **#2** (6 GP, 39.5 MPG).
Blurb: fine. Prior: 2024 79 GP · #2 | 2025 70 GP · #1. Cross-season: 2→1→1 — metronome.
Vs consensus: outproducing even a #4 consensus.

**Tyrese Maxey (PHI) · cons #7 · age 26 · 70 GP** — window #5→#5
Concerns: none on the tag. Confidence: **High**.
Playoffs 26: **#13** (11 GP, 39.8 MPG). Blurb: the downward playoff rider ("fell well short") is technically true on the z-scale but reads far too harsh for a man who was #13 in the playoffs — this is the rider's value-vs-rank blind spot. Suggest softer copy when the playoff rank is still elite: "his playoff level dipped from #5 to a still-excellent #13."
Prior: 2024 70 GP · #28 | 2025 52 GP · #18. Cross-season: 28→18→5 — three-year ascent to the elite tier.
Vs consensus: matches #7 consensus.

**Chet Holmgren (OKC) · cons #12 · age 24 · 69 GP** — window #44→#24 (+20 inside the "near" band)
Concerns: none; the +20 improvement is real but below the ±40 break-out bar. Confidence: **High**.
Playoffs 26: **#15** (15 GP, 30.6 MPG). Blurb: fine.
Prior: 2024 82 GP · #29 | 2025 32 GP · #64. Cross-season: 29→(injury 64)→24 — back to trend after the injury year.
Vs consensus: production #24 vs cons #12 — close enough; healthy convergence upward.

**Giannis Antetokounmpo (MIA) · cons #20 · age 32 · 36 GP** — window #9→#19
Concerns: only 36 GP, 4/12 stale (0.333 — one under the injury gate), and both other metrics read fading. The #19 finish is partly idle-drift. Confidence: **Medium** — STABLE is acceptable, but INJURY-LIMITED describes the season better.
Playoffs 26: n/a. Blurb: fine as far as it goes; a games-played caveat would help.
Prior: 2024 73 GP · #7 | 2025 67 GP · #4. Cross-season: 7→4→19 — the rank drop is availability, not per-game slippage.
Vs consensus: tracking #20 consensus exactly — but on 36 games.

**Deni Avdija (POR) · cons #24 · age 26 · 66 GP** — window #36→#35
Concerns: none. Confidence: **High**. Playoffs 26: n/a (5 GP).
Blurb: fine. Prior: 2024 75 GP · #132 | 2025 72 GP · #88. Cross-season: 132→88→35 — one of the cleanest three-year risers in the pool; consensus has caught up.
Vs consensus: #35 vs #24 — market slightly ahead of production, fair.

**LaMelo Ball (MIN) · cons #27 · age 25 · 72 GP** — window #53→#34
Concerns: none. Confidence: **High**. Playoffs 26: n/a.
Blurb: fine. Prior: 2024 22 GP · #14 | 2025 47 GP · #35. Cross-season: finally a 72-game season; value landed right at his healthy-year level.
Vs consensus: #34 vs #27 — aligned.

**Trey Murphy III (NOP) · cons #30 · age 26 · 66 GP** — window #32→#21
Concerns: none. Confidence: **High**. Playoffs 26: n/a.
Blurb: fine. Prior: 2024 56 GP · #83 | 2025 53 GP · #36. Cross-season: 83→36→21 — steady riser, now outproducing consensus.
Vs consensus: 9 ahead of #30 — arguably trending toward SURGING next season.

**Karl-Anthony Towns (NYK) · cons #34 · age 31 · 75 GP** — window #26→#22
Concerns: none. Confidence: **High**.
Playoffs 26: **#6** (19 GP, 30.4 MPG) — elite run; upward rider present and correct.
Prior: 2024 62 GP · #34 | 2025 72 GP · #9. Cross-season: 34→9→22 — orbiting the top 25 with a monster 2025.
Vs consensus: 12 ahead of #34.

**Bam Adebayo (MIA) · cons #43 · age 29 · 73 GP** — window #55→#49
Concerns: mid-season dip to #106 recovered fully — the endpoints happen to be honest here, but the intra-window swing shows how much the endpoint read can hide. Confidence: **High**.
Playoffs 26: n/a. Blurb: fine.
Prior: 2024 71 GP · #49 | 2025 78 GP · #61. Cross-season: 49→61→49 — flat, durable, consensus-accurate.
Vs consensus: matches #43.

**Donovan Clingan (POR) · cons #51 · age 22 · 77 GP** — window #61→#44
Concerns: none. Confidence: **High**. Playoffs 26: n/a (5 GP).
Blurb: fine. Prior: 2025 67 GP · #148. Cross-season: 148→44 — a sophomore leap the tag undersells; he improved +17 inside the window too.
Vs consensus: 7 ahead of #51 — trending better than STABLE implies.

**Jalen Suggs (ORL) · cons #66 · age 25 · 56 GP** — window #46→#52
Concerns: blocks 4–6 nearly empty (0/2/2) — mid-season absence, but he returned and played through the finish, so the endpoints are trustworthy. Confidence: **Medium-High**.
Playoffs 26: **#56** (7 GP, 35.3 MPG) — exactly his season level.
Prior: 2024 75 GP · #123 | 2025 35 GP · #75. Cross-season: 123→75→52 — improving each year despite injuries.
Vs consensus: 14 ahead of #66.

**Reed Sheppard (HOU) · cons #73 · age 22 · 82 GP** — window #66→#82
Concerns: none — 82 games, fully sampled. Confidence: **High**.
Playoffs 26: **#43** (6 GP, 32.2 MPG) — raised his level; a qualifying upward rider is arguably missing (6 GP ≥ 4, check the z-jump).
Prior: 2025 52 GP · #386. Cross-season: 386→82 — enormous sophomore leap; the flat window sits on top of a step-function career arc.
Vs consensus: #82 vs #73 — aligned.

**Kel'el Ware (MIL) · cons #77 · age 22 · 77 GP** — window #45→#65
Concerns: the −20 in-window drift brushes the edge of the near-band; a few more spots and he'd read very differently. Confidence: **Medium-High**.
Playoffs 26: n/a. Blurb: fine.
Prior: 2025 64 GP · #124. Cross-season: 124→65 — year-over-year improvement even with the soft finish.
Vs consensus: 12 ahead of #77.

**Jaden McDaniels (MIN) · cons #89 · age 26 · 73 GP** — window #67→#79
Concerns: none; other metrics read surging (his TO/FT profile shifts the gap across metrics). Confidence: **High** for Minus1V.
Playoffs 26: **#72** (12 GP, 33.8 MPG) — consistent with the season.
Prior: 2024 72 GP · #210 | 2025 82 GP · #92. Cross-season: 210→92→79 — two-year riser consolidating.
Vs consensus: 10 ahead of #89.

**Jabari Smith Jr. (HOU) · cons #95 · age 23 · 77 GP** — window #109→#102
Concerns: none. Confidence: **High**.
Playoffs 26: **#32** (6 GP, 42.0 MPG) — a substantial playoff leap with a huge minutes spike; another spot where an upward rider looks warranted but absent.
Prior: 2024 76 GP · #110 | 2025 57 GP · #147. Cross-season: 110→147→102 — flat-ish with a down 2025.
Vs consensus: #102 vs #95 — aligned.

**Devin Vassell (SAS) · cons #118 · age 26 · 67 GP** — window #100→#135
Concerns: −35 in-window is one spot from the PLUNGING bar and the gap (+17) is three from FADING — he's the "worst allowable STABLE." Two stale blocks mid-season. Confidence: **Medium** — the tag is rule-correct but flatters the season.
Playoffs 26: **#44** (23 GP, 34.8 MPG) — excellent, and the upward rider correctly rescues the story.
Prior: 2024 68 GP · #93 | 2025 64 GP · #94. Cross-season: 93→94→135 — mild decline year.
Vs consensus: 17 behind #118 — watch for FADING next build.

**Jakob Poeltl (TOR) · cons #129 · age 31 · 46 GP** — window #107→#114
Concerns: 4/12 stale (0.333 again) — blocks 5–7 empty; mid-window ranks drifted to #157 while idle, then recovered on his return. Endpoints happen to land honestly, but this card was one absence away from nonsense. Confidence: **Medium**.
Playoffs 26: **#80** (7 GP, 19.1 MPG) — solid.
Prior: 2024 50 GP · #63 | 2025 57 GP · #46. Cross-season: 63→46→114 — a real down year at 31; STABLE-vs-consensus masks a value decline the market already priced.
Vs consensus: 15 ahead of #129.

**Toumani Camara (POR) · cons #133 · age 26 · 82 GP** — window #165→#149
Concerns: none — 82 games. Confidence: **High**.
Playoffs 26: n/a (5 GP). Prior: 2024 70 GP · #238 | 2025 78 GP · #111. Cross-season: 238→111→149 — leap then partial give-back; defense-first profile caps the ceiling.
Vs consensus: 16 behind #133 — mild disappointment vs market, fairly called STABLE.

**P.J. Washington (DAL) · cons #144 · age 28 · 56 GP** — window #139→#136
Concerns: none material. Confidence: **High**.
Playoffs 26: n/a. Prior: 2024 73 GP · #145 | 2025 57 GP · #109. Cross-season: 145→109→136 — bouncing inside a stable band.
Vs consensus: matches #144.

**Max Christie (DAL) · cons #211 · age 23 · 77 GP** — window #170→#200
Concerns: −30 drift inside the near-band, and **both** other metrics read REGRESSING — the Minus1V gap happens to sit at −11 while 9-cat/8-cat gaps cross the line. Cross-metric whiplash on one card. Confidence: **Medium** — STABLE is defensible; expect users to notice the mismatch.
Playoffs 26: n/a. Prior: 2024 67 GP · #393 | 2025 76 GP · #238. Cross-season: 393→238→200 — every year better; the within-season fade is off a hot start.
Vs consensus: 11 ahead of #211.

**Keon Ellis (BKN) · cons #222 · age 27 · 72 GP** — window #220→#228
Concerns: none. Confidence: **High**.
Playoffs 26: n/a (12 GP but 7.3 MPG). Prior: 2024 57 GP · #229 | 2025 80 GP · #108. Cross-season: 229→108→228 — 2025 was the outlier; back to his baseline.
Vs consensus: matches #222.

**Baylor Scheierman (BOS) · cons #300 · age 26 · 77 GP** — window #311→#320
Concerns: none. Confidence: **High**.
Playoffs 26: **#114** (7 GP, 14.0 MPG) — a real playoff pop from a fringe player; worth a rider.
Prior: 2025 31 GP · #427. Cross-season: 427→320 — modest sophomore progress.
Vs consensus: 20 behind #300 — right at the edge of FADING; fine as STABLE.

**Julian Strawther (DEN) · cons #340 · age 24 · 57 GP** — window #393→#359 (+34)
Concerns: 9-cat reads BREAKING-OUT and 8-cat CLIMBING off the same season — the Minus1V +34 just misses the +40 bar. Two stale blocks early. Confidence: **Medium** — the metric split will confuse; Minus1V STABLE is rule-correct.
Playoffs 26: n/a (2 GP). Prior: 2024 50 GP · #458 | 2025 65 GP · #326. Cross-season: 458→326→359 — fringe rotation, slightly better than 2024, slightly worse than 2025.
Vs consensus: 19 behind #340.

**Sidy Cissoko (POR) · cons #410 · age 22 · 75 GP** — window #379→#404
Concerns: 9-cat/8-cat read REGRESSING (his gap sits just inside the near-band on Minus1V). Confidence: **Medium-High**.
Playoffs 26: n/a (4 GP). Prior: 2024 12 GP · #352 | 2025 22 GP · #560 (tiny samples). Cross-season: first real NBA season; deep-bench value.
Vs consensus: matches #410.

**Stable — group verdict.** The strongest tag in the system — for full-sample players it is nearly always right, and it correctly holds stars (Jokic, Wemby, Maxey) and role players alike. Watch items: borderline-band players whose other metrics disagree (Christie, Strawther, Vassell), availability-flattered cards at 4/12 stale (Giannis, Poeltl), and the too-harsh downward playoff rider on elite playoff performers (Maxey).

### INJURY-LIMITED (sampled 25 of 59)

*This tag is factual (stale-block share ≥ 0.35), so the review focuses on whether "injury" is the right story and whether the small-sample cumRank is being framed honestly.*

**Jayson Tatum (BOS) · cons #10 · age 28 · 16 GP** — cum #23 on 16 games
Concerns: rank on 16 games is a small-sample estimate, but it points *up*, and the blurb's "reflects games missed, not a production decline" is exactly right here. Confidence: **High**.
Playoffs 26: **#9** (6 GP, 36.3 MPG) — returned at full level; the strongest possible signal for his consensus.
Prior: 2024 74 GP · #17 | 2025 71 GP · #14. Cross-season: 17→14→(injury) — no decline evidence whatsoever.
Vs consensus: producing at/above #10 whenever on the floor.

**Trae Young (WAS) · cons #22 · age 28 · 15 GP** — cum #97 on 15 games
Concerns: 15-game sample at a career-low 25.5 MPG — the #97 is neither trustworthy nor damning. Confidence: **High** (tag), with the note that his return level, not this rank, is the question.
Playoffs 26: n/a. Prior: 2024 54 GP · #15 | 2025 76 GP · #16. Cross-season: 15→16→(lost year) — elite baseline, one lost season.
Vs consensus: #22 consensus already prices meaningful risk.

**Anthony Davis (WAS) · cons #55 · age 33 · 20 GP** — cum #28 on 20 games
Concerns: none beyond the sample size — per-game he was still top-30. Confidence: **High**.
Playoffs 26: n/a. Prior: 2024 76 GP · #5 | 2025 52 GP · #6. Cross-season: 5→6→(20 games at #28) — durability, not production, is the entire discount.
Vs consensus: outproducing #55 by 27 when available.

**Ja Morant (POR) · cons #72 · age 27 · 20 GP** — cum #73 on 20 games
Concerns: sample scattered across seven blocks (never >2 games after block 1). Confidence: **High**.
Playoffs 26: n/a. Prior: 2024 9 GP · #41 (9-game sample) | 2025 50 GP · #55. Cross-season: perpetual availability discount; per-game value drifting down slowly across three injury-marred years.
Vs consensus: production matches #72 exactly when he plays.

**Jalen Green (PHX) · cons #99 · age 24 · 32 GP** — cum #210
Concerns: mid-season cum spiked to #295 then recovered — classic small-sample churn; final #210 is on 32 games of rusty, restarted season. Confidence: **High** (tag); treat the rank as unreliable.
Playoffs 26: n/a (4 GP). Prior: 2024 82 GP · #130 | 2025 82 GP · #113. Cross-season: two full 82-game seasons at #110–130, then a lost year — the healthy baseline is much better than the 2026 line.
Vs consensus: #99 consensus ≈ his healthy level; reasonable.

**Zach LaVine (SAC) · cons #107 · age 31 · 39 GP** — cum #124
Concerns: played blocks 0–7, then out for the season — rank frozen since March. Confidence: **High**.
Playoffs 26: n/a. Prior: 2024 25 GP · #87 | 2025 74 GP · #56. Cross-season: healthy 2025 was top-60; 2026 pre-shutdown was #120-ish — a real step down at 31, worth remembering when he returns.
Vs consensus: #124 vs #107 — the market's mild fade looks right.

**Aaron Gordon (DEN) · cons #150 · age 31 · 36 GP** — cum #141
Concerns: in-and-out all season (5/12 stale); the #65 early-season rank decayed to #141 across absences — direction contaminated by idle drift. Confidence: **High** (tag).
Playoffs 26: n/a (3 GP). Prior: 2024 73 GP · #117 | 2025 51 GP · #131. Cross-season: 117→131→141 — gentle decline trend visible under the injuries.
Vs consensus: matches #150.

**Ty Jerome (MEM) · cons #186 · age 29 · 15 GP** — cum #48 on 15 games
Concerns: the blurb says the rank "reflects games missed, not a production decline" — but his rank is *inflated upward* by a hot 15-game sample; the caveat is written one-directional and reads wrong here. Confidence: **High** (tag) / **blurb needs the two-sided version** (systemic fix H).
Playoffs 26: n/a. Prior: 2024 2 GP · #507 (ignore) | 2025 70 GP · #119. Cross-season: 2025 breakout was real (70 games); 2026's #48 on 15 games shouldn't be quoted as a level.
Vs consensus: consensus #186 splits the difference sensibly.

**Miles McBride (NYK) · cons #234 · age 26 · 41 GP** — cum #179
Concerns: none beyond the gaps. Confidence: **High**.
Playoffs 26: **#123** (19 GP, 17.5 MPG) — durable playoff contributor at his season level.
Prior: 2024 68 GP · #230 | 2025 64 GP · #191. Cross-season: 230→191→179 — quietly improving each year.
Vs consensus: 55 ahead of #234 when he plays.

**Obi Toppin (IND) · cons #276 · age 28 · 24 GP** — cum #181
Concerns: cum swung #154→#317→#181 across his injury return — small-sample churn on display; final rank near his baseline. Confidence: **High**.
Playoffs 26: n/a. Prior: 2024 82 GP · #170 | 2025 79 GP · #206. Cross-season: consistent #170–210 level when healthy.
Vs consensus: ~95 ahead of #276 per-game.

**Terrence Shannon Jr. (MIN) · cons #328 · age 26 · 43 GP** — cum #425
Concerns: 12.4 MPG when active — a role problem stacked on an availability problem. Confidence: **High**.
Playoffs 26: **#107** (9 GP, 22.6 MPG) — his playoff role was *bigger* than his regular-season one and he delivered; that's the most interesting fact on this card and the blurb misses it (rider requires ≥ +0.3 z; verify it fired).
Prior: 2025 32 GP · #442. Cross-season: little healthy track record; playoffs are the bull case.
Vs consensus: n/m at this sample.

**Tidjane Salaun (CHA) · cons #366 · age 21 · 36 GP** — cum #350
Concerns: many 1-game blocks — the availability pattern reads like rotation churn as much as injury. Confidence: **Medium-High**.
Playoffs 26: n/a. Prior: 2025 60 GP · #412. Cross-season: 412→350 — modest year-2 progress buried in DNPs.
Vs consensus: near #366.

**Grant Williams (CHA) · cons #374 · age 28 · 36 GP** — cum #274
Concerns: missed the first five blocks (ACL recovery), played the run-in. Confidence: **High**.
Playoffs 26: n/a. Prior: 2024 75 GP · #235 | 2025 16 GP · #133 (16-game sample). Cross-season: useful when healthy; two straight interrupted years.
Vs consensus: 100 ahead of #374 in his healthy stretch.

**Moritz Wagner (BKN) · cons #395 · age 29 · 36 GP** — cum #382
Concerns: same shape as Grant Williams (returned mid-year); late fade in a small role. Confidence: **High**.
Playoffs 26: n/a (2 GP). Prior: 2024 80 GP · #208 | 2025 30 GP · #216. Cross-season: steady bench value before the injury; 2026 never got going.
Vs consensus: near #395.

**RayJ Dennis (ATL) · cons #416 · age 25 · 17 GP** — cum #435
Concerns: 17 games, 12.1 MPG — this is a two-way usage pattern, not an injury narrative. Confidence: **Medium** — tag fires correctly, label misleads (fix H).
Playoffs 26: n/a. Prior: 2025 11 GP · #426. Cross-season: fringe.

**Ron Harper Jr. (BOS) · cons #446 · age 26 · 29 GP** — cum #379
Concerns: two-way usage pattern; "missed significant time" implies injury that likely wasn't. Confidence: **Medium** (fix H).
Playoffs 26: n/a (6 GP, 4.2 MPG). Prior: 2024 3 GP · #540 | 2025 1 GP · #324 (both meaningless samples). Cross-season: first year with real NBA minutes.

**Malachi Smith (BKN) · cons #999 (fallback) · age 27 · 15 GP** — cum #207 on 15 games
Concerns: late-season call-up (all 15 games in the final two blocks) — not injury; and no valid consensus. The #207 on a hot 15-game sample will read as a level. Confidence: **Medium-Low** — keep the availability gate, rename the story (fix H) and suppress consensus-dependent framing (fix A).
Playoffs 26: n/a. Prior: none. Cross-season: n/a.

**Mac McClung (CHI) · cons #999 (fallback) · age 28 · 11 GP** — cum #362
Concerns: 11 games — two-way/G-League pattern; "injury-limited" is the wrong noun. Confidence: **Medium-Low** (fix H).
Playoffs 26: n/a. Prior: 2025 2 GP · #544. Cross-season: n/a.

**KJ Simpson (DEN) · cons #999 (fallback) · age 24 · 20 GP** — cum #436
Concerns: scattered 1–2 game blocks; two-way pattern. Confidence: **Medium-Low** (fix H).
Playoffs 26: n/a. Prior: 2025 36 GP · #331. Cross-season: fringe, down-trending.

**Malevy Leons (GSW) · cons #999 (fallback) · age 27 · 25 GP** — cum #388
Concerns: two-way pattern. Confidence: **Medium-Low** (fix H).
Playoffs 26: n/a. Prior: 2025 14 GP · #566. Cross-season: fringe.

**Jalen Slawson (IND) · cons #999 (fallback) · age 27 · 13 GP** — cum #122 on 13 games
Concerns: the sharpest example of small-sample inflation in the whole audit — #122 on 13 late-season games at 23.9 MPG. Any surface quoting this rank without a games caveat misleads. Confidence: **Medium-Low** (fix H + two-sided caveat).
Playoffs 26: n/a. Prior: 2024 12 GP · #517. Cross-season: n/a.

**Taurean Prince (MIL) · cons #999 (fallback) · age 32 · 26 GP** — cum #265
Concerns: played blocks 0–1, vanished, returned for the run-in — plausibly genuine injury; consensus missing. Confidence: **Medium**.
Playoffs 26: n/a. Prior: 2024 78 GP · #236 | 2025 81 GP · #219. Cross-season: durable vet until this year; baseline ~#220–240.

**DeAndre Jordan (NOP) · cons #999 (fallback) · age 38 · 12 GP** — cum #270
Concerns: 12 games at 38 — end-of-career DNP pattern, not injury. Confidence: **Medium-Low** (fix H).
Playoffs 26: n/a. Prior: 2024 36 GP · #403 | 2025 56 GP · #394. Cross-season: emeritus.

**Bez Mbeng (UTA) · cons #999 (fallback) · age 23 · 15 GP** — cum #121 on 15 games
Concerns: all 15 games in the last two blocks at 32.9 MPG (tank-season audition); #121 is a raw April sample. Same inflation warning as Slawson. Confidence: **Medium-Low** (fix H).
Playoffs 26: n/a. Prior: none. Cross-season: n/a.

**Sharife Cooper (WAS) · cons #999 (fallback) · age 25 · 41 GP** — cum #339
Concerns: 5/12 stale, fringe usage; consensus missing. Confidence: **Medium**.
Playoffs 26: n/a. Prior: none since 2022. Cross-season: n/a.

**Injury-limited — group verdict.** The gate itself works — every sampled player genuinely missed big chunks of season. Two fixes: (1) the blurb's "reflects games missed, not a production decline" is one-directional and reads backwards for hot-sample players (Jerome #48, Slawson #122, Mbeng #121, Tatum #23) — it should also warn the rank may be *inflated*; (2) for two-way/call-up players (McClung, Leons, Dennis, Mbeng, Slawson, Jordan) "injury" is the wrong frame — a neutral "LIMITED SAMPLE" label fits, and most of these are also consensus-999 cases that shouldn't carry consensus-anchored copy at all.

### BREAKING-OUT (sampled 11 of 11 — full population)

**Amen Thompson (HOU) · cons #19 · age 23 · 79 GP** — window #96→#37 (+59)
Concerns: none — 79 games, monotone climb. Confidence: **High**. The system's best advertisement.
Playoffs 26: **#17** (6 GP, 44.2 MPG) — carried the breakout into the playoffs.
Blurb: accurate; keep.
Prior: 2024 62 GP · #139 | 2025 69 GP · #57. Cross-season: 139→57→37 — three-year ascent, each step real.
Vs consensus: production #37 vs cons #19 — market already believes; the tag confirms.

**Jaren Jackson Jr. (UTA) · cons #39 · age 27 · 48 GP** — window #119→#54 (+65)
Concerns: **didn't play after block 8** (0/0/0 — 4/12 stale, one under the injury gate). "BREAKING OUT" on a player idle for six weeks is the trailing-absence artifact at its worst. The climb while playing was real. Confidence: **Low → recommend INJURY-LIMITED** (or the tag with an idle caveat).
Playoffs 26: n/a. Prior: 2024 66 GP · #46 | 2025 74 GP · #39. Cross-season: 46→39→54 — he was returning to his normal level, not breaking out; the early-season cum was depressed by a slow start.
Vs consensus: #54 vs #39 — tracking his established rank, ironically STABLE-shaped.

**Brandon Miller (CHA) · cons #50 · age 24 · 65 GP** — window #105→#53 (+52)
Concerns: the window starts at #105 because his season opened with injury (2/0/4-game blocks; cum #281→#312 before the reset) — the "+52 surge" is largely recovery-from-cold-start. His finish (#53) matches his healthy 2025 level (#63 in 27 games). Confidence: **Medium-Low → recommend STABLE or SURGING framing** ("back to form"), not a breakout.
Playoffs 26: n/a. Prior: 2024 74 GP · #122 | 2025 27 GP · #63. Cross-season: 122→63→53 — a genuine improvement arc, but this season's move was a return, not a leap.
Vs consensus: #53 vs #50 — dead on the market.

**Matas Buzelis (CHI) · cons #69 · age 22 · 77 GP** — window #114→#74 (+40)
Concerns: none — full sample, steady climb, and a 232→74 year-over-year leap behind it. Confidence: **High**. The genuine article.
Playoffs 26: n/a. Prior: 2025 80 GP · #232. Cross-season: 232→74 — true sophomore breakout.
Vs consensus: matches #69 and still rising.

**Maxime Raynaud (SAC) · cons #157 · age 23 · 74 GP** — window #312→#148 (+164)
Concerns: cold-start inflation (blocks 0–1: 2/4 games) exaggerates the printed +164; his real second half (~#150–170) is still an emphatic rookie rise. Confidence: **Medium-High** — keep, soften the number.
Playoffs 26: n/a. Prior: none (rookie). Cross-season: n/a.
Vs consensus: #148 vs #157 — market caught up fast.

**Kyle Filipowski (UTA) · cons #180 · age 23 · 77 GP** — window #245→#173 (+72)
Concerns: none material. Confidence: **High**.
Playoffs 26: n/a. Prior: 2025 72 GP · #253. Cross-season: 253→173 — clean year-2 step.
Vs consensus: #173 vs #180 — aligned, arrow up.

**Isaiah Collier (UTA) · cons #207 · age 22 · 59 GP** — window #290→#204 (+86)
Concerns: early cum bounced (#201→#290 on thin blocks) so the start point is shaky; the second-half level (~#200) is real. Confidence: **Medium**.
Playoffs 26: n/a. Prior: 2025 71 GP · #315. Cross-season: 315→204 — real year-2 growth.
Vs consensus: matches #207.

**Brice Sensabaugh (UTA) · cons #220 · age 23 · 75 GP** — window #272→#231 (+41)
Concerns: +41 barely clears the +40 bar, and the path meandered (#285 mid-season). Confidence: **Medium** — one spot from STABLE; expect churn between builds.
Playoffs 26: n/a. Prior: 2024 32 GP · #367 | 2025 71 GP · #247. Cross-season: 367→247→231 — incremental, not explosive.
Vs consensus: #231 vs #220 — aligned; "BREAKING OUT" oversells this one.

**Oso Ighodaro (PHX) · cons #244 · age 24 · 82 GP** — window #295→#232 (+63)
Concerns: none — 82 games. Confidence: **High**.
Playoffs 26: n/a (4 GP). Prior: 2025 61 GP · #358. Cross-season: 358→232 — solid year-2 step.
Vs consensus: #232 vs #244 — aligned.

**GG Jackson (MEM) · cons #248 · age 22 · 55 GP** — window #398→#239 (+159)
Concerns: heavy cold-start inflation — blocks 0–4 were 2/4/2/0/4 games (injury recovery), so the #398 start is a starved sample; his healthy second half ran ~#225–250. Confidence: **Medium-Low → recommend keeping direction but re-anchoring copy** ("healthy again and back to his 2024 level") — the +159 number is mostly artifact.
Playoffs 26: n/a. Prior: 2024 47 GP · #217 | 2025 29 GP · #451. Cross-season: 217→451→239 — round trip through injury; recovery, not breakout.
Vs consensus: #239 vs #248 — aligned.

**Leonard Miller (CHI) · cons #289 · age 23 · 46 GP** — window #397→#296 (+101)
Concerns: 46 GP at 15.7 MPG with nine of twelve blocks at ≤3 games — the "surge" is concentrated in the final three blocks (6/7/11 games), i.e., late-season/tank minutes. Confidence: **Low → recommend a limited-sample/no-tag treatment**; the +101 print is not robust.
Playoffs 26: n/a. Prior: 2024 17 GP · #454 | 2025 13 GP · #510 (both tiny). Cross-season: no reliable baseline.
Vs consensus: near #289, but on April evidence.

**Breaking-out — group verdict.** When the sample is full (Thompson, Buzelis, Filipowski, Ighodaro) this tag is the system's most valuable output. Its failure mode is **cold-start inflation**: injury-recovery players (Miller, Jackson, JJJ) and late-season-minutes players (L. Miller) print +50 to +160 "surges" that are mostly the starved start point. A minimum-games-by-window-start guard (fix B) would clean up 5 of these 11 cards.

---

### SURGING (sampled 25 of 66)

**Lauri Markkanen (UTA) · cons #46 · age 29 · 43 GP** — window #22→#17
Concerns: **didn't play after block 8** (0/0/0; 4/12 stale — one under the gate). "Holding well above where the market has him" describes a man who wasn't playing. Confidence: **Low → recommend INJURY-LIMITED** (trailing-absence rule, fix C).
Playoffs 26: n/a. Prior: 2024 55 GP · #25 | 2025 47 GP · #85. Cross-season: 25→85→17 — elite per-game level re-established this year, availability now the only question.
Vs consensus: 29 ahead of #46 when active.

**Stephen Curry (GSW) · cons #56 · age 38 · 43 GP** — window #11→#8
Concerns: blocks 8–10 empty, 4-game final block — the #8 is carried through a long absence (3/12 stale). Same trailing-absence caveat, slightly less severe. Confidence: **Medium** — tag right on production, needs an availability rider at minimum.
Playoffs 26: n/a. Prior: 2024 74 GP · #19 | 2025 70 GP · #11. Cross-season: 19→11→8 — still climbing the per-game boards at 38, on shrinking games.
Vs consensus: 48 ahead of #56 — the market prices age; his hands haven't heard.

**Kevin Durant (HOU) · cons #59 · age 38 · 78 GP** — window #33→#10 (+23)
Concerns: none — 78 games at 38. Confidence: **High**.
Playoffs 26: n/a (1 GP). Blurb: accurate.
Prior: 2024 75 GP · #9 | 2025 62 GP · #10. Cross-season: 9→10→10 — zero decline signal in the values.
Vs consensus: 49 ahead of #59 — the ur-example of market age-discount vs real production.

**Jarrett Allen (CLE) · cons #84 · age 28 · 56 GP** — window #80→#61
Concerns: two mid-season stale blocks; fine. Confidence: **High**.
Playoffs 26: **#33** (18 GP, 29.3 MPG) — upward rider present and earned.
Prior: 2024 77 GP · #43 | 2025 82 GP · #51. Cross-season: 43→51→61 — actually drifting *down* year-over-year; SURGING here means "above consensus," not "improving" — the label/semantics gap (fix G).
Vs consensus: 23 ahead of #84.

**Nickeil Alexander-Walker (ATL) · cons #90 · age 28 · 77 GP** — window #78→#39 (+39)
Concerns: none — full sample, career year. Confidence: **High**.
Playoffs 26: **#88** (6 GP, 35.5 MPG) — came back to earth in the playoffs; no downward rider fired (jump likely < 0.3 z), acceptable.
Prior: 2024 82 GP · #207 | 2025 82 GP · #255. Cross-season: 207→255→39 — a massive genuine leap with the move to Atlanta.
Vs consensus: 51 ahead of #90 — consensus badly trailing.

**Rudy Gobert (MIN) · cons #127 · age 34 · 76 GP** — window #73→#42 (+31)
Concerns: **9-cat and 8-cat both read AGING-DECLINE on the same card** — Minus1V drops his FT%, hiding the category that's declining. The most jarring cross-metric contradiction in the audit. Confidence: **Medium-High** for Minus1V itself (76 games, real climb) — but the card needs the metric-context made explicit.
Playoffs 26: **#64** (12 GP, 31.1 MPG). Prior: 2024 76 GP · #26 | 2025 72 GP · #60. Cross-season: 26→60→42 — down from peak, stabilized in punt-FT builds.
Vs consensus: 85 ahead of #127 in Minus1V terms.

**Ayo Dosunmu (MIN) · cons #156 · age 26 · 69 GP** — window #126→#112 (+14)
Concerns: none. Confidence: **High**.
Playoffs 26: **#40** (10 GP, 29.0 MPG) — major playoff riser; check why no upward rider fired.
Prior: 2024 76 GP · #147 | 2025 46 GP · #149. Cross-season: 147→149→112 — best year of the three.
Vs consensus: 44 ahead of #156.

**Neemias Queta (BOS) · cons #173 · age 27 · 76 GP** — window #81→#60 (+21)
Concerns: none. Confidence: **High**.
Playoffs 26: **#59** (7 GP, 21.7 MPG) — held his level.
Prior: 2024 28 GP · #212 | 2025 61 GP · #293. Cross-season: 212→293→60 — a true role-driven breakout; arguably BREAKING-OUT was the fairer tag earlier in the year.
Vs consensus: 113 ahead of #173 — one of the largest live gaps; consensus review candidate.

**Saddiq Bey (NOP) · cons #200 · age 27 · 72 GP** — window #163→#90 (+73)
Concerns: none in-season; he sat out all of 2025 (ACL) so history is thin. Confidence: **High**.
Playoffs 26: n/a. Prior: 2024 63 GP · #135 | 2025 — did not play. Cross-season: returned from a lost year straight past his 2024 level.
Vs consensus: 110 ahead of #200 — consensus still pricing the injury.

**Collin Sexton (LAL) · cons #204 · age 28 · 68 GP** — window #151→#157 (flat)
Concerns: the tag says SURGING; the window is flat and his year-over-year value is *declining* (104→127→157). "Holding above a stale consensus" is the honest story. Confidence: **Medium** — semantics fix G; data fine.
Playoffs 26: n/a. Prior: 2024 78 GP · #104 | 2025 63 GP · #127. Cross-season: gentle three-year fade.
Vs consensus: 47 ahead of #204.

**Julian Champagnie (SAS) · cons #228 · age 25 · 82 GP** — window #146→#140 (flat)
Concerns: same flat-above-consensus semantics. Confidence: **Medium-High**.
Playoffs 26: **#53** (23 GP, 30.7 MPG) — huge playoff sample at a top-55 level; rider present and correct.
Prior: 2024 75 GP · #267 | 2025 82 GP · #194. Cross-season: 267→194→140 — improving every year; durable.
Vs consensus: 88 ahead of #228 — consensus review candidate.

**Jalen Smith (CHI) · cons #260 · age 26 · 53 GP** — window #174→#160 (+14)
Concerns: thin blocks late (1/5/1 games around block 9–11). Confidence: **Medium**.
Playoffs 26: n/a. Prior: 2024 61 GP · #174 | 2025 64 GP · #202. Cross-season: 174→202→160 — bouncing in a band.
Vs consensus: 100 ahead of #260.

**Jake LaRavia (LAL) · cons #280 · age 25 · 82 GP** — window #224→#226 (flat)
Concerns: early cum (#87 at block 0) shows how hot he opened; flat window since. Confidence: **Medium-High** (semantics note only).
Playoffs 26: **#135** (8 GP, 14.3 MPG). Prior: 2024 36 GP · #223 | 2025 66 GP · #296. Cross-season: 223→296→226 — fine bench value, no trend.
Vs consensus: 54 ahead of #280.

**Justin Champagnie (WAS) · cons #291 · age 25 · 69 GP** — window #296→#174 (+122)
Concerns: none serious — sustained climb on a real sample. Confidence: **High**.
Playoffs 26: n/a. Prior: 2024 15 GP · #279 | 2025 62 GP · #151. Cross-season: 2025 already showed this level; 2026 confirmed it.
Vs consensus: 117 ahead of #291 — consensus review candidate.

**Javon Small (MEM) · cons #315 · age 24 · 41 GP** — window #355→#222 (+133)
Concerns: rookie, 41 GP, 3/12 stale, and the climb is concentrated late — cold-start plus late-minutes flavor. Confidence: **Medium-Low** — direction plausible, +133 print inflated (fix B).
Playoffs 26: n/a. Prior: none. Cross-season: n/a.
Vs consensus: 93 ahead of #315, on a thin base.

**Spencer Jones (DEN) · cons #326 · age 25 · 64 GP** — window #329→#291 (+38)
Concerns: none major. Confidence: **Medium-High**.
Playoffs 26: **#74** (6 GP, 24.0 MPG) — striking playoff pop for a fringe wing; worth surfacing.
Prior: 2025 20 GP · #513. Cross-season: first real season.
Vs consensus: 35 ahead of #326.

**Jamir Watkins (WAS) · cons #336 · age 25 · 50 GP** — window #357→#271 (+86)
Concerns: rookie; five blocks at ≤3 games — sample choppy. Confidence: **Medium**.
Playoffs 26: n/a. Prior: none. Cross-season: n/a.
Vs consensus: 65 ahead of #336.

**Ja'Kobe Walter (TOR) · cons #357 · age 22 · 73 GP** — window #268→#251 (+17)
Concerns: none. Confidence: **High**.
Playoffs 26: **#50** (7 GP, 32.1 MPG) — dramatic playoff emergence far above his season level; the card's most important fact.
Prior: 2025 52 GP · #328. Cross-season: 328→251 — steady year-2 progress, then the playoff leap.
Vs consensus: 106 ahead of #357.

**Tristan Vukcevic (WAS) · cons #372 · age 23 · 49 GP** — window #348→#299 (+49)
Concerns: 13.7 MPG; several 1–3 game blocks. Confidence: **Medium**.
Playoffs 26: n/a. Prior: 2024 10 GP · #295 | 2025 35 GP · #261. Cross-season: per-minute producer who can't get minutes; values bounce with role.
Vs consensus: 73 ahead of #372.

**Jock Landale (ATL) · cons #389 · age 31 · 68 GP** — window #216→#220 (flat)
Concerns: 9-cat and 8-cat both read REGRESSING — Minus1V's dropped category flips the read; another cross-metric whiplash card. Confidence: **Medium-Low** — suggest aligning copy with the majority metric or noting the split.
Playoffs 26: n/a. Prior: 2024 56 GP · #311 | 2025 42 GP · #401. Cross-season: 311→401→220 — best year of three.
Vs consensus: 169 ahead of #389.

**Isaac Okoro (CHI) · cons #397 · age 25 · 63 GP** — window #261→#268 (flat)
Concerns: metric split (9-cat surging, 8-cat regressing). Confidence: **Medium**.
Playoffs 26: n/a. Prior: 2024 69 GP · #215 | 2025 55 GP · #352. Cross-season: 215→352→268 — partial rebound year.
Vs consensus: 129 ahead of a #397 consensus that treats him as a non-asset.

**Olivier-Maxence Prosper (MEM) · cons #426 · age 24 · 53 GP** — window #326→#243 (+83)
Concerns: mid-season 1-game blocks; climb concentrated after block 7. Confidence: **Medium**.
Playoffs 26: n/a. Prior: 2024 40 GP · #490 | 2025 52 GP · #488. Cross-season: 490→488→243 — first year of real NBA value.
Vs consensus: 183 ahead of #426.

**Cameron Johnson (DEN) · cons #999 (fallback) · age 30 · 54 GP** — window #214→#154 (+60)
Concerns: **this is a name-join bug, not a fringe player** — he's a established top-150 asset (ranks #142/#66 the last two years) missing from the dynasty join, so his card cites "#999 consensus." Likely a "Cam Johnson"/"Cameron Johnson" normalization miss. Confidence: **Low → fix the join, then re-derive** (true tag vs a realistic ~#100–130 consensus would be CLIMBING/STABLE).
Playoffs 26: **#70** (6 GP, 31.2 MPG). Prior: 2024 57 GP · #142 | 2025 57 GP · #66. Cross-season: 142→66→154 — down year after a career 2025.

**Micah Potter (IND) · cons #999 (fallback) · age 28 · 47 GP** — window #209→#196
Concerns: invalid consensus; 4/12 stale (missed the first four blocks). Confidence: **Low → suppress tag**.
Playoffs 26: n/a. Prior: 2024 16 GP · #365 | 2025 38 GP · #361. Cross-season: fringe big having his best run.

**Branden Carlson (POR) · cons #999 (fallback) · age 27 · 42 GP** — window #310→#310
Concerns: invalid consensus; flat window; metric split (9/8-cat regressing). Confidence: **Low → suppress tag**.
Playoffs 26: n/a. Prior: 2025 32 GP · #370. Cross-season: fringe.

**Surging — group verdict.** Two distinct populations wear one label: genuine climbers (Durant, NAW, Queta, Bey, J. Champagnie) and **flat players sitting above a stale consensus** (Sexton, LaRavia, Landale, Okoro) — the latter are consensus-calibration signals, not trends (fix G: consider an "OUTPRODUCING" variant for flat-above). Plus the recurring defects: trailing-absence stars (Markkanen, Curry), cross-metric whiplash (Gobert, Landale), and three consensus-999 cards including the Cameron Johnson join bug.

### FADING (sampled 25 of 31)

**Alperen Sengun (HOU) · cons #15 · age 24 · 72 GP** — window #29→#40 (−11)
Concerns: the gap (+25) is barely past the near-band and the move (−11) barely past the floor — he's the "least faded FADING" possible, in a **career-best value season** (#40 vs #47/#77 prior). Confidence: **Medium-Low → recommend STABLE**; the tag reads far more bearish than the data.
Playoffs 26: **#21** (6 GP, 38.7 MPG) — top-25 playoff production.
Blurb: "slipping further — down ~11 spots" overstates an 11-spot drift for a top-40 player; rewrite around "tracking just below a very aggressive #15 consensus."
Prior: 2024 63 GP · #47 | 2025 76 GP · #77. Cross-season: 47→77→40 — best of the three years.
Vs consensus: #15 consensus prices a leap he hasn't fully made in 9-cat terms; that's a consensus question, not a player fade.

**Alex Sarr (WAS) · cons #35 · age 21 · 48 GP** — window #39→#56 (−17)
Concerns: 4/12 stale with a nearly empty run-in (0/1/5/1 games in the last four blocks) — the slide from #39 is substantially idle-drift while hurt. Year-over-year he *leapt* (141→56). Confidence: **Low → recommend INJURY-LIMITED**.
Playoffs 26: n/a. Prior: 2025 67 GP · #141. Cross-season: 141→56 — a big genuine sophomore improvement; FADING inverts the real story.
Vs consensus: #56 vs #35 on 48 games of a 21-year-old — the market's bet looks fine.

**De'Aaron Fox (SAS) · cons #44 · age 29 · 72 GP** — window #28→#81 (−53)
Concerns: the #28 start rode a hot ~11-game November; his settled level was #60–80 all second half. Direction is real, magnitude inflated by the start point. Confidence: **Medium**.
Playoffs 26: **#60** (21 GP, 33.6 MPG) — solid, slightly above his season finish.
Blurb: fine directionally; consider "settled in the 60–80 range after a top-30 start."
Prior: 2024 74 GP · #33 | 2025 62 GP · #31. Cross-season: 33→31→81 — a real step down this year at 29; worth the tag.
Vs consensus: 37 behind #44 — market still pricing the old level.

**Stephon Castle (SAS) · cons #53 · age 26* · 68 GP** — window #83→#111 (−28) *(roster DOB looks wrong — he's 21; worth fixing in `nba_roster`)*
Concerns: this is a **sophomore-leap season** (292→111 YoY) tagged as FADING because consensus (#53) already prices the leap plus more. In-window drift is real but modest. Confidence: **Medium-Low → recommend STABLE with a "consensus is ahead of production" blurb**, or keep FADING only with that framing.
Playoffs 26: **#35** (23 GP, 33.1 MPG) — outstanding, over a large sample; the upward rider fires and is the truest line on the card.
Prior: 2025 80 GP · #292. Cross-season: 292→111 — one of the biggest YoY risers in the pool.
Vs consensus: 58 behind #53 — the market is betting on exactly what the playoffs showed.

**Ivica Zubac (IND) · cons #64 · age 29 · 48 GP** — window #50→#92 (−42)
Concerns: 3/12 stale with blocks 8–9 and 11 empty — the late slide is heavily absence-driven (traded + hurt?). Confidence: **Low → recommend INJURY-LIMITED**.
Playoffs 26: n/a. Prior: 2024 68 GP · #90 | 2025 80 GP · #29. Cross-season: 90→29→92 — a career 2025, then an interrupted 2026; per-game level when active was fine early.
Vs consensus: 28 behind #64, mostly absence.

**Cedric Coward (MEM) · cons #92 · age 23 · 62 GP** — window #155→#164 (flat)
Concerns: rookie whose first month was scorching (cum #61 at block 0) — the market (#92) chased the hot start, production settled at ~#160. Confidence: **Medium-High** (FADING-as-"not closing the gap" is accurate).
Playoffs 26: n/a. Prior: none. Cross-season: n/a.
Vs consensus: 72 behind #92 — the tag is doing honest work against an over-eager consensus.

**Tari Eason (HOU) · cons #110 · age 25 · 60 GP** — window #166→#169 (flat)
Concerns: 9-cat reads CRATERING off the same season (its gap/trend cross different bars) — cross-metric whiplash. Two stale blocks early. Confidence: **Medium**.
Playoffs 26: **#20** (6 GP, 32.5 MPG) — spectacular playoff surge; the blurb has no rider (verify; 6 GP qualifies). That fact reframes the whole card.
Prior: 2024 22 GP · #112 | 2025 57 GP · #79. Cross-season: 112→79→169 — a genuinely down regular season.
Vs consensus: 59 behind #110, then #20 in the playoffs — "regular-season fade, playoff monster" is the real story.

**Egor Demin (BKN) · cons #123 · age 20 · 52 GP** — window #207→#212 (flat)
Concerns: rookie; final two blocks empty (0/0) — finish frozen since March. Confidence: **Medium-Low** — FADING with an idle finish and a dynasty-priced consensus; a rookie-aware read (fix E) plus idle caveat (fix C) both apply.
Playoffs 26: n/a. Prior: none. Cross-season: n/a.
Vs consensus: 89 behind a #123 consensus that prices his draft slot, not his rookie stats.

**Jaime Jaquez Jr. (MIL) · cons #142 · age 25 · 75 GP** — window #148→#177 (−29)
Concerns: none material — full sample. Confidence: **Medium-High**.
Playoffs 26: n/a. Prior: 2024 75 GP · #186 | 2025 66 GP · #295. Cross-season: 186→295→177 — best year of the three despite the soft finish; the YoY rebound deserves a mention in the blurb.
Vs consensus: 35 behind #142.

**Jaylon Tyson (CLE) · cons #146 · age 24 · 66 GP** — window #77→#170 (−93)
Concerns: the #77 start is a ~17-game hot streak artifact; his season settled exactly where a first-year starter should. The −93 print doubles his real change. Confidence: **Medium** — tag right, magnitude inflated (fix B).
Playoffs 26: **#159** (17 GP, 12.8 MPG) — bench role, level held; the downward rider on the card is fair.
Prior: 2025 47 GP · #464. Cross-season: 464→170 — huge YoY step forward hidden under a bearish tag.
Vs consensus: 24 behind #146.

**Malik Monk (SAC) · cons #176 · age 28 · 62 GP** — window #160→#224 (−64)
Concerns: none — steady, well-sampled decline. Confidence: **High**.
Playoffs 26: n/a. Prior: 2024 72 GP · #140 | 2025 65 GP · #87. Cross-season: 140→87→224 — sharp fall from a career 2025.
Vs consensus: 48 behind #176 — market still ahead of production; tag earns its keep.

**Jordan Poole (NOP) · cons #178 · age 27 · 39 GP** — window #121→#216 (−95)
Concerns: 39 GP, 3/12 stale, blocks 7–11 mostly 2–4 games — availability and form are entangled; the #121 start is also early-sample. Confidence: **Medium-Low → recommend INJURY-LIMITED** (or FADING with an availability caveat).
Playoffs 26: n/a. Prior: 2024 78 GP · #114 | 2025 68 GP · #58. Cross-season: 114→58→216 — a genuinely alarming YoY collapse either way.
Vs consensus: 38 behind #178.

**Anfernee Simons (PHI) · cons #187 · age 27 · 55 GP** — window #208→#213 (flat)
Concerns: **last three blocks empty (0/0/0)** — finish is pure idle-drift; "without closing the gap" describes a man not playing. Confidence: **Low → recommend INJURY-LIMITED** (trailing-absence rule).
Playoffs 26: n/a. Prior: 2024 46 GP · #73 | 2025 70 GP · #100. Cross-season: 73→100→213 — two-year value slide is real and pre-dates the absence.
Vs consensus: 26 behind #187.

**Jaylen Wells (MEM) · cons #196 · age 23 · 69 GP** — window #241→#258 (−17)
Concerns: final block empty (0 games). Confidence: **Medium-High**.
Playoffs 26: n/a. Prior: 2025 79 GP · #277. Cross-season: 277→258 — flat sophomore year.
Vs consensus: 62 behind #196 — consensus pricing growth that hasn't come.

**Carter Bryant (SAS) · cons #214 · age 21 · 71 GP** — window #390→#403 (−13)
Concerns: rookie deep-reserve (11.5 MPG) measured against a **dynasty** consensus that prices his draft pedigree — production rank was never going to approach #214. This is the rookie-consensus mismatch (fix E) in pure form. Confidence: **Low → recommend rookie-aware handling** (suppress FADING copy; "developing" framing).
Playoffs 26: n/a (22 GP but 8.5 MPG — under your bar; for what it's worth he ranked #153 in that deep run).
Prior: none. Cross-season: n/a.
Vs consensus: 189 behind — the number measures the dynasty discount, not a fade.

**Daniss Jenkins (DET) · cons #215 · age 25 · 72 GP** — window #258→#295 (−37)
Concerns: volatile path (#175 at block 1 → #341 at block 9). Confidence: **Medium**.
Playoffs 26: **#100** (14 GP, 22.6 MPG) — major playoff riser; rider present and correct.
Prior: 2025 7 GP · #571 (ignore). Cross-season: first real season; the playoff sample is the headline.
Vs consensus: 80 behind #215 in the regular season, then #100 in the playoffs.

**Jarace Walker (IND) · cons #217 · age 23 · 76 GP** — window #236→#253 (−17)
Concerns: 9-cat reads CLIMBING off the same season — whiplash again (Minus1V drops different worst-cats across the year). Confidence: **Medium**.
Playoffs 26: n/a. Prior: 2024 33 GP · #368 | 2025 75 GP · #355. Cross-season: 355→253 — a real YoY step forward that the FADING tag obscures.
Vs consensus: 36 behind #217.

**Walter Clayton Jr. (MEM) · cons #218 · age 23 · 70 GP** — window #286→#318 (−32)
Concerns: none major. Confidence: **Medium-High**.
Playoffs 26: n/a. Prior: none (rookie). Cross-season: n/a.
Vs consensus: 100 behind a consensus pricing the draft slot; partially the rookie mismatch, but the in-season drift is also real.

**Ryan Dunn (PHX) · cons #245 · age 23 · 70 GP** — window #147→#304 (−157)
Concerns: the #147 start reflects a hot-shooting October (cum #120 at block 0); the collapse to #304 is real but ~half start-artifact. One spot of gap short of CRATERING — expect tag churn. Confidence: **Medium**.
Playoffs 26: n/a (4 GP). Prior: 2025 74 GP · #334. Cross-season: 334→304 — flat sophomore year around a wild in-season arc.
Vs consensus: 59 behind #245.

**Hugo Gonzalez (BOS) · cons #247 · age 20 · 74 GP** — window #336→#364 (−28)
Concerns: rookie deep-bench (14.6 MPG) vs dynasty consensus — same mismatch as Bryant, milder. Confidence: **Medium-Low** (fix E).
Playoffs 26: n/a (4 GP). Prior: none. Cross-season: n/a.
Vs consensus: 117 behind — dynasty discount, not fade.

**Danny Wolf (BKN) · cons #250 · age 22 · 57 GP** — window #269→#289 (−20)
Concerns: final block empty; early blocks 1/1 games — both endpoints shaky. Confidence: **Medium-Low**.
Playoffs 26: n/a. Prior: none (rookie). Cross-season: n/a.
Vs consensus: 39 behind #250.

**Ousmane Dieng (MIL) · cons #257 · age 23 · 57 GP** — window #346→#356 (−10)
Concerns: choppy sample (0/1/2-game blocks). Confidence: **Medium**.
Playoffs 26: n/a. Prior: 2024 33 GP · #408 | 2025 37 GP · #428. Cross-season: 408→428→356 — best of three, still fringe.
Vs consensus: 99 behind #257.

**Devin Carter (ATL) · cons #298 · age 24 · 38 GP** — window #353→#354 (flat)
Concerns: 4/12 stale (0.333 again), 38 GP scattered — availability season. Confidence: **Low → recommend INJURY-LIMITED**.
Playoffs 26: n/a. Prior: 2025 36 GP · #494. Cross-season: two straight injury-limited years; no clean baseline yet.
Vs consensus: 56 behind #298.

**Ryan Nembhard (DAL) · cons #314 · age 23 · 60 GP** — window #282→#352 (−70)
Concerns: window start (#282) follows a #241 peak on thin early blocks (3/2/4 games) — inflated start, real fade after. Confidence: **Medium**.
Playoffs 26: n/a. Prior: none (rookie). Cross-season: n/a.
Vs consensus: 38 behind #314.

**Jordan Hawkins (NOP) · cons #387 · age 24 · 51 GP** — window #373→#429 (−56)
Concerns: none — a genuine slide to the fringe. Confidence: **High**.
Playoffs 26: n/a. Prior: 2024 66 GP · #351 | 2025 56 GP · #282. Cross-season: 351→282→429 — worst of three; role gone (13.5 MPG).
Vs consensus: 42 behind #387.

**Fading — group verdict.** Works well as a "consensus is ahead of production" flag for veterans (Monk, Hawkins, Wells, Coward). Three failure modes: (1) **trailing-absence players** frozen below consensus (Simons, Zubac, Sarr, Devin Carter — all should be availability reads); (2) **rookies/sophomores measured against dynasty consensus** (Bryant, Gonzalez, Demin, Castle — the gap measures the dynasty discount, not a fade, and Castle/Sengun are career-best seasons wearing bearish tags); (3) hot-start inflation of the printed move (Tyson −93, Dunn −157, Fox −53).

---

### CRATERING (sampled 12 of 12 — full population)

**Dylan Harper (SAS) · cons #31 · age 20 · 69 GP** — window #173→#230 (−57)
Concerns: the harshest card in the system sits on a **rookie** whose #31 consensus prices his long-term upside, and whose most recent form was elite — **#61 across 23 playoff games at 26.7 MPG**. The code's own comments cite Harper as the reason the postseason rider exists; the rider fires, but the tag still screams CRATERING with a ⚰️-adjacent ⚠️. Confidence: **Low → recommend rookie-aware reclassification** (CLIMBING/"developing" framing, or at minimum FADING).
Playoffs 26: **#61** (23 GP, 26.7 MPG).
Prior: none (rookie). Cross-season: n/a.
Vs consensus: 199 behind #31 — the number measures dynasty pricing of a 20-year-old, not a collapse.

**Coby White (CHA) · cons #106 · age 26 · 50 GP** — window #82→#202 (−120)
Concerns: the #82 start is one of the clearest artifacts in the audit — his cum was **#3 after one game** (block 1) and #82 on ~9 games at the window start; injured early, never 26 GP by mid-window. Honest start would be ~#180; the real story is FADING (~−20), not a −120 crater. Confidence: **Low → recommend FADING** (fix B poster child).
Playoffs 26: n/a. Prior: 2024 79 GP · #107 | 2025 74 GP · #68. Cross-season: 107→68→202 — a genuinely bad, injury-marred year; direction fine, magnitude wrong.
Vs consensus: 96 behind #106.

**Tre Johnson (WAS) · cons #113 · age 20 · 60 GP** — window #246→#287 (−41)
Concerns: rookie vs dynasty consensus (fix E); the in-season slide (early cum #155 → #287) is real but normal rookie-wall shape. Confidence: **Medium-Low → recommend FADING with rookie framing**.
Playoffs 26: n/a. Prior: none. Cross-season: n/a.
Vs consensus: 174 behind #113 — mostly the dynasty discount.

**Nikola Jovic (MIA) · cons #239 · age 23 · 47 GP** — window #323→#414 (−91)
Concerns: final three blocks nearly empty (0/1/1 — injured); part of the collapse is idle-drift. Confidence: **Medium** — genuine bad year, availability-contaminated finish.
Playoffs 26: n/a. Prior: 2024 46 GP · #287 | 2025 46 GP · #198. Cross-season: 287→198→414 — sharp reversal of an improving arc; injury year.
Vs consensus: 175 behind #239.

**Rob Dillingham (CHI) · cons #242 · age 22 · 65 GP** — window #370→#431 (−61)
Concerns: none technical — a well-sampled slide to the bottom of the pool. Confidence: **Medium-High**.
Playoffs 26: n/a. Prior: 2025 49 GP · #492. Cross-season: 492→431 — two fringe years; consensus (#242) still pricing draft pedigree.
Vs consensus: 189 behind — partly dynasty discount (sophomore), partly real.

**Jase Richardson (ORL) · cons #278 · age 21 · 54 GP** — window #372→#430 (−58)
Concerns: rookie, 10.9 MPG — barely above the display floor; rank noise dominates at this usage. Confidence: **Medium-Low** (fix E).
Playoffs 26: n/a (1 GP). Prior: none. Cross-season: n/a.
Vs consensus: 152 behind #278.

**Drake Powell (BKN) · cons #294 · age 21 · 64 GP** — window #240→#372 (−132)
Concerns: the #240 start rides thin early blocks (2/5 games); real level ~#330–370. Rookie vs dynasty consensus on top. Confidence: **Medium-Low → recommend FADING with rookie framing**.
Playoffs 26: n/a. Prior: none. Cross-season: n/a.
Vs consensus: 78 behind #294.

**Gradey Dick (LAC) · cons #309 · age 23 · 76 GP** — window #307→#385 (−78)
Concerns: none — 76 games, benched to 14 MPG, value followed. Confidence: **High**.
Playoffs 26: n/a (3 GP). Prior: 2024 60 GP · #323 | 2025 54 GP · #187. Cross-season: 323→187→385 — a real career reversal; the tag is earned.
Vs consensus: 76 behind #309.

**Asa Newell (ATL) · cons #317 · age 21 · 44 GP** — window #341→#384 (−43)
Concerns: rookie, 11.4 MPG, 3/12 stale, several 1-game blocks — noise-dominated. Confidence: **Medium-Low** (fix E).
Playoffs 26: n/a (2 GP). Prior: none. Cross-season: n/a.
Vs consensus: 67 behind #317.

**Tyrese Proctor (CLE) · cons #329 · age 22 · 50 GP** — window #347→#399 (−52)
Concerns: rookie, 11.0 MPG, thin blocks late (2/2/0). Confidence: **Medium-Low** (fix E).
Playoffs 26: n/a (4 GP). Prior: none. Cross-season: n/a.
Vs consensus: 70 behind #329.

**Noah Penda (ORL) · cons #331 · age 21 · 59 GP** — window #301→#392 (−91)
Concerns: rookie, 12.9 MPG. Confidence: **Medium-Low** (fix E).
Playoffs 26: n/a (1 GP). Prior: none. Cross-season: n/a.
Vs consensus: 61 behind #331.

**Tyler Kolek (NYK) · cons #349 · age 25 · 62 GP** — window #362→#415 (−53)
Concerns: none — a real slide at the fringe. Confidence: **Medium-High**.
Playoffs 26: n/a (8 GP, 6.6 MPG). Prior: 2025 41 GP · #498. Cross-season: 498→415 — still fringe.
Vs consensus: 66 behind #349.

**Cratering — group verdict.** **Ten of twelve CRATERING players are 23 or younger, and eight are first- or second-year players.** The tag is functioning as a rookie-penalty: dynasty consensus prices upside, deep-bench rookie production sits 60+ spots below it, any slide clears the −40 bar, and the scariest label in the system lands on the youngest assets (Harper, with a #61 playoff run, is the indictment). Only Gradey Dick and Kolek — actual veterans-in-decline — read as intended. Recommend the rookie-aware gate (fix E) plus the start-point guard (fix B, which alone would fix Coby White).

### PLUNGING (sampled 17 of 17 — full population)

**Tyler Herro (MIL) · cons #49 · age 26 · 33 GP** — window #15→#57 (−42)
Concerns: the #15 start is a **4-game sample** (his first block back from injury), and he's 4/12 stale — one block under the injury gate. The −42 "plunge" is almost entirely start-point artifact plus absence. Confidence: **Low → recommend INJURY-LIMITED**.
Playoffs 26: n/a. Prior: 2024 42 GP · #99 | 2025 77 GP · #27. Cross-season: 99→27→57 — a healthy 2025 career year, then an injury season; nothing "plunged."
Vs consensus: #57 vs #49 — on 33 games, essentially at consensus.

**Mikal Bridges (NYK) · cons #76 · age 30 · 82 GP** — window #18→#63 (−45)
Concerns: 82 games, real decline from a hot start — but "**crashed to #63**" when his consensus is #76 means the blurb describes *converging to a rank better than the market's* as a crash. The near-band plunge copy is sign-blind (fix D). Confidence: **Medium → keep direction, fix copy** (REGRESSING-style: "cooling from a top-20 start, still ahead of his #76 consensus").
Playoffs 26: **#55** (19 GP, 32.1 MPG) — steady at his level.
Prior: 2024 82 GP · #102 | 2025 82 GP · #95. Cross-season: 102→95→63 — his best value season of the three; the tag punishes the shape of the year, not the year.
Vs consensus: 13 ahead of #76.

**Isaiah Hartenstein (OKC) · cons #81 · age 28 · 47 GP** — window #54→#100 (−46)
Concerns: 3/12 stale (blocks 5–6 empty, 1-game block 3) — the slide is availability-entangled. Confidence: **Medium-Low → recommend INJURY-LIMITED or availability caveat**.
Playoffs 26: **#57** (15 GP, 23.4 MPG) — back at his early-season level in the playoffs.
Prior: 2024 75 GP · #68 | 2025 57 GP · #70. Cross-season: 68→70→100 — mild dip in an injury year, playoffs say fine.
Vs consensus: 19 behind #81.

**Miles Bridges (PHX) · cons #120 · age 28 · 77 GP** — window #56→#119 (−63)
Concerns: full sample, real fade — but gapNow is **−1**: he finished a spot *ahead* of consensus, and the blurb says production "crashed to #119" vs a #120 consensus. Sign-blind copy again (fix D). Confidence: **Medium → keep direction, fix copy**.
Playoffs 26: n/a. Prior: 2024 69 GP · #60 | 2025 64 GP · #72. Cross-season: 60→72→119 — two-year drift down; that part is real.
Vs consensus: exactly at consensus (−1).

**Aaron Nesmith (IND) · cons #174 · age 27 · 45 GP** — window #130→#185 (−55)
Concerns: 45 GP, blocks 2–4 nearly empty, choppy availability throughout — form and absence entangled. Confidence: **Medium-Low → INJURY-LIMITED or caveat**.
Playoffs 26: n/a. Prior: 2024 72 GP · #128 | 2025 45 GP · #123. Cross-season: 128→123→185 — down year on limited games.
Vs consensus: 11 behind #174.

**Davion Mitchell (MIA) · cons #203 · age 28 · 70 GP** — window #122→#186 (−64)
Concerns: gapNow **−17** — he finished *ahead* of consensus in a **career-best season** (398→251→186 across three years), yet the card says production "crashed." The plunge is a hot start (cum #122) normalizing to a level still above the market's. Confidence: **Low → recommend STABLE** (or SURGING-side copy).
Playoffs 26: n/a. Prior: 2024 72 GP · #398 | 2025 74 GP · #251. Cross-season: 398→251→186 — monotone three-year *improvement*; the tag inverts his actual arc.
Vs consensus: 17 ahead of #203.

**Quentin Grimes (LAL) · cons #206 · age 26 · 74 GP** — window #93→#192 (−99)
Concerns: the #93 start rides his famous hot scoring stretch; he settled at #192, right at consensus (gap −14, i.e., slightly ahead). Same sign-blind copy issue. Confidence: **Medium → keep direction, fix copy** ("cooled from a top-100 start to his market level").
Playoffs 26: **#99** (11 GP, 22.1 MPG) — a meaningful playoff riser; no rider on the card (verify).
Prior: 2024 51 GP · #321 | 2025 75 GP · #165. Cross-season: 321→165→192 — roughly held his 2025 gains.
Vs consensus: 14 ahead of #206.

**De'Andre Hunter (SAC) · cons #233 · age 29 · 45 GP** — window #157→#244 (−87)
Concerns: **didn't play the last four blocks** (0/0/0/0 — 4/12 stale, one under the gate). The printed plunge is half idle-drift. Confidence: **Low → recommend INJURY-LIMITED** (trailing-absence rule).
Playoffs 26: n/a. Prior: 2024 57 GP · #167 | 2025 64 GP · #117. Cross-season: 167→117→244 — down year even before the shutdown.
Vs consensus: 11 behind #233.

**Aaron Wiggins (ATL) · cons #274 · age 28 · 65 GP** — window #145→#290 (−145)
Concerns: the #145 start sits on thin early blocks (2/1 games in blocks 1–2); honest start ~#200. Real fade after, magnitude inflated ~2×. Confidence: **Medium**.
Playoffs 26: n/a (13 GP but 5.8 MPG). Prior: 2024 78 GP · #266 | 2025 75 GP · #180. Cross-season: 266→180→290 — gave back the 2025 gains.
Vs consensus: 16 behind #274.

**Sion James (CHA) · cons #324 · age 24 · 82 GP** — window #267→#329 (−62)
Concerns: 82 games; the #267 start (and #127 block-0 cum) was an unsustainable hot 3PT month; he landed at #329 — **five spots off his consensus**. Normalization, not a plunge. Confidence: **Medium-Low → recommend STABLE**.
Playoffs 26: n/a. Prior: 2026 rookie year only. Cross-season: n/a.
Vs consensus: 5 behind #324 — dead on the market.

**Jamaree Bouyea (PHX) · cons #355 · age 27 · 46 GP** — window #221→#360 (−139)
Concerns: the #221 start is a ~9-game artifact after two empty blocks; fringe player churn. Confidence: **Medium-Low** — direction fine, print inflated.
Playoffs 26: n/a (4 GP). Prior: 2024 10 GP · #546 | 2025 5 GP · #439 (both meaningless). Cross-season: first real NBA season.
Vs consensus: 5 ahead of #355.

**Marcus Sasser (DET) · cons #362 · age 26 · 38 GP** — window #324→#380 (−56)
Concerns: 3/12 stale, 38 GP, start sits after three empty blocks — availability season. Confidence: **Medium-Low → INJURY-LIMITED candidate**.
Playoffs 26: **#138** (6 GP, 10.3 MPG) — clears your gate by a hair and ranked well above his season level; noteworthy.
Prior: 2024 72 GP · #294 | 2025 57 GP · #343. Cross-season: 294→343→380 — three-year drift out of the rotation.
Vs consensus: 18 behind #362.

**Jaylen Clark (MIN) · cons #398 · age 25 · 68 GP** — window #340→#417 (−77)
Concerns: none — well-sampled fringe fade. Confidence: **Medium-High**.
Playoffs 26: n/a (6 GP, 9.3 MPG — under the minutes bar). Prior: 2025 40 GP · #362. Cross-season: 362→417 — down.
Vs consensus: 19 behind #398.

**Micah Peavy (NOP) · cons #411 · age 25 · 61 GP** — window #343→#401 (−58)
Concerns: gapNow **−10** — finished ahead of his consensus; "crashed to #401" vs #411 is the sign-blind copy again. Rookie at the fringe. Confidence: **Medium-Low → STABLE + copy fix**.
Playoffs 26: n/a. Prior: none. Cross-season: n/a.
Vs consensus: 10 ahead of #411.

**Tyrese Martin (PHI) · cons #421 · age 27 · 46 GP** — window #277→#406 (−129)
Concerns: real collapse of a small role (16.8 MPG, fell out of rotation late — 1–3 game blocks from block 7 on); part idle-drift. Confidence: **Medium**.
Playoffs 26: n/a (1 GP). Prior: 2025 60 GP · #340. Cross-season: 340→406 — down.
Vs consensus: 15 ahead of #421 (both at the fringe).

**Tre Mann (CHA) · cons #438 · age 25 · 52 GP** — window #297→#432 (−135)
Concerns: real fade (12.5 MPG by year end); start mildly inflated by a decent October. gapNow −6. Confidence: **Medium** — direction real; copy again says "crashed to" a rank equal to consensus.
Playoffs 26: n/a. Prior: 2024 41 GP · #181 | 2025 13 GP · #241. Cross-season: 181→241→432 — a two-year collapse from rotation player to fringe; that part deserves the alarm.
Vs consensus: 6 ahead of #438.

**Dalton Knecht (LAL) · cons #443 · age 25 · 54 GP** — window #291→#427 (−136)
Concerns: real collapse (10.2 MPG by year end); gapNow −16 (ahead of a bottomed-out consensus). Confidence: **Medium-High** — the market already gave up; tag matches.
Playoffs 26: n/a (5 GP). Prior: 2025 79 GP · #310. Cross-season: 310→427 — sophomore slump confirmed.
Vs consensus: 16 ahead of #443.

**Plunging — group verdict.** The near-consensus band makes this tag fire on two very different things: (1) genuine collapses (Knecht, Mann, Martin, Clark — fine), and (2) **hot starts normalizing to (or above) consensus** (Mikal & Miles Bridges, Mitchell, Grimes, James, Peavy) where "crashed" is sign-blind — five of these finished *ahead* of their consensus rank. Plus the availability set (Herro's 4-game start point, Hunter's four empty closing blocks, Hartenstein, Nesmith, Sasser). Fixes D (sign-aware copy), B (start guard), C (trailing absence) would clean 11 of 17 cards.

---

### CLIMBING (sampled 21 of 21 — full population)

**Cooper Flagg (DAL) · cons #6 · age 20 · 70 GP** — window #94→#45 (+49)
Concerns: none — this is the tag working exactly as designed for a rookie: below a dynasty consensus, closing fast. Confidence: **High**. (Contrast with Harper's CRATERING — same situation, opposite label, purely because Flagg's arrow points up. The rookie-aware fix should make Harper-type cards look more like this one.)
Playoffs 26: n/a. Prior: none. Cross-season: n/a.
Vs consensus: 39 behind #6 and closing — exactly what a #1-pick rookie card should say.

**Darius Garland (LAC) · cons #38 · age 26 · 45 GP** — window #179→#72 (+107)
Concerns: 4/12 stale and the #179 start is a ~7-game post-injury sample — the +107 is inflated. But unlike the Markkanen-type cases he **finished playing** (4/6/9 games in the last three blocks), so the endpoint is live. Confidence: **Medium** — keep CLIMBING, expect the print to halve with a start guard.
Playoffs 26: n/a. Prior: 2024 57 GP · #81 | 2025 75 GP · #48. Cross-season: 81→48→72 — established top-75 guard recovering from injury.
Vs consensus: 34 behind #38.

**Paolo Banchero (ORL) · cons #42 · age 24 · 72 GP** — window #138→#89 (+49)
Concerns: none. Confidence: **High**.
Playoffs 26: **#28** (7 GP, 39.0 MPG) — a genuine playoff surge; rider check warranted.
Prior: 2024 80 GP · #124 | 2025 46 GP · #107. Cross-season: 124→107→89 — slow, steady climb toward his consensus; 9-cat build still caps him.
Vs consensus: 47 behind #42 — the gap is his FG%/TO profile, and it's shrinking.

**VJ Edgecombe (PHI) · cons #45 · age 21 · 75 GP** — window #128→#70 (+58)
Concerns: none — full rookie sample. Confidence: **High**.
Playoffs 26: **#71** (11 GP, 36.9 MPG) — held his exact level in the playoffs.
Prior: none. Cross-season: n/a.
Vs consensus: 25 behind #45 and closing — model rookie card.

**Zion Williamson (NOP) · cons #63 · age 26 · 62 GP** — window #124→#84 (+40)
Concerns: two stale blocks early; fine. Confidence: **High** (62 GP is a durability win by his standards).
Playoffs 26: n/a. Prior: 2024 70 GP · #66 | 2025 30 GP · #47. Cross-season: healthy-year level consistently top-70; the climb is him shaking off a slow start.
Vs consensus: 21 behind #63.

**Derik Queen (NOP) · cons #74 · age 22 · 81 GP** — window #153→#130 (+23)
Concerns: none — 81-game rookie sample. Confidence: **High**.
Playoffs 26: n/a. Prior: none. Cross-season: n/a.
Vs consensus: 56 behind #74 — dynasty-priced, climbing appropriately.

**Ace Bailey (UTA) · cons #80 · age 20 · 73 GP** — window #226→#193 (+33)
Concerns: mid-season dip (#286) recovered; endpoints fair. Confidence: **High**.
Playoffs 26: n/a. Prior: none. Cross-season: n/a.
Vs consensus: 113 behind #80 — big dynasty discount, arrow correct.

**Collin Murray-Boyles (TOR) · cons #85 · age 21 · 57 GP** — window #309→#167 (+142)
Concerns: thin blocks 8–10 (2/2/1) just before a big final block (9 games) — the finish is real but the path is choppy. Confidence: **Medium-High**.
Playoffs 26: **#23** (7 GP, 27.3 MPG) — a monster playoff sample; arguably the best under-22 playoff line in the pool. The card should shout this.
Prior: none. Cross-season: n/a.
Vs consensus: 82 behind #85 in the regular season; #23 in the playoffs.

**Anthony Black (ORL) · cons #101 · age 22 · 63 GP** — window #187→#158 (+29)
Concerns: late blocks thin (0/4 games in 10–11). Confidence: **Medium-High**.
Playoffs 26: **#85** (7 GP, 28.0 MPG) — above his season level.
Prior: 2024 69 GP · #427 | 2025 79 GP · #274. Cross-season: 427→274→158 — clean three-year riser.
Vs consensus: 57 behind #101.

**Shaedon Sharpe (POR) · cons #109 · age 23 · 50 GP** — window #168→#131 (+37)
Concerns: **barely played after block 7** (0/0/0/2) — "closing the gap" describes a frozen rank; 3/12 stale evades the gate. Confidence: **Low → recommend INJURY-LIMITED or idle caveat** (fix C).
Playoffs 26: n/a (5 GP). Prior: 2024 32 GP · #152 | 2025 72 GP · #168. Cross-season: 152→168→131 — flat-ish; talent/production gap persists.
Vs consensus: 22 behind #109.

**Bilal Coulibaly (WAS) · cons #128 · age 22 · 56 GP** — window #176→#151 (+25)
Concerns: choppy sample (1–3 game blocks scattered). Confidence: **Medium**.
Playoffs 26: n/a. Prior: 2024 63 GP · #246 | 2025 59 GP · #175. Cross-season: 246→175→151 — steady annual progress.
Vs consensus: 23 behind #128.

**Christian Braun (DEN) · cons #147 · age 25 · 44 GP** — window #201→#188 (+13)
Concerns: 4/12 stale (0.333 — under the gate again) with a mid-season absence that swung his cum #201→#273→#188; the +13 print is the difference of two noisy endpoints. Confidence: **Low → recommend INJURY-LIMITED**.
Playoffs 26: **#90** (6 GP, 31.3 MPG) — back at his real level.
Prior: 2024 82 GP · #320 | 2025 79 GP · #78. Cross-season: 320→78→188 — breakout 2025, injury-noised 2026; healthy level likely top-100.
Vs consensus: 41 behind #147.

**Will Riley (WAS) · cons #191 · age 20 · 74 GP** — window #392→#330 (+62)
Concerns: deep-bench rookie vs dynasty consensus — but the arrow is up, so the tag reads fairly. Confidence: **Medium-High**.
Playoffs 26: n/a. Prior: none. Cross-season: n/a.
Vs consensus: 139 behind #191 — dynasty discount, correctly framed as "closing."

**Bub Carrington (WAS) · cons #199 · age 21 · 82 GP** — window #328→#282 (+46)
Concerns: none in-sample (82 GP) — but year-over-year he *declined* (231→282); the in-window climb is recovery from an awful start, not net progress. Confidence: **Medium** — blurb could acknowledge the YoY step back.
Playoffs 26: n/a. Prior: 2025 82 GP · #231. Cross-season: 231→282 — sophomore dip.
Vs consensus: 83 behind #199.

**Kasparas Jakucionis (MIL) · cons #205 · age 20 · 53 GP** — window #389→#308 (+81)
Concerns: 4/12 stale with an essentially empty first month — the start point is starved (fix B applies), inflating the climb. Confidence: **Medium**.
Playoffs 26: n/a. Prior: none. Cross-season: n/a.
Vs consensus: 103 behind #205.

**Nique Clifford (SAC) · cons #213 · age 24 · 75 GP** — window #363→#332 (+31)
Concerns: none major. Confidence: **Medium-High**.
Playoffs 26: n/a. Prior: none (rookie). Cross-season: n/a.
Vs consensus: 119 behind #213.

**Gui Santos (GSW) · cons #225 · age 24 · 68 GP** — window #391→#283 (+108)
Concerns: none — sustained second-half climb on a real sample. Confidence: **High**.
Playoffs 26: n/a. Prior: 2024 23 GP · #377 | 2025 56 GP · #409. Cross-season: 377→409→283 — first year of real value.
Vs consensus: 58 behind #225.

**Taylor Hendricks (MEM) · cons #237 · age 23 · 60 GP** — window #344→#288 (+56)
Concerns: volatile path (#288→#371→#288 swings); choppy blocks. Confidence: **Medium**.
Playoffs 26: n/a. Prior: 2024 40 GP · #185 | 2025 3 GP · #114 (3-game sample — ignore). Cross-season: pre-injury 2024 level was better than anything he showed this year; still rebuilding.
Vs consensus: 51 behind #237.

**Nolan Traore (BKN) · cons #262 · age 20 · 56 GP** — window #394→#351 (+43)
Concerns: rookie, choppy early sample (2/12 stale). Confidence: **Medium**.
Playoffs 26: n/a. Prior: none. Cross-season: n/a.
Vs consensus: 89 behind #262.

**Yanic Konan Niederhauser (LAC) · cons #265 · age 23 · 41 GP** — window #375→#340 (+35)
Concerns: 10.4 MPG (at the display floor), final two blocks empty — the "climb" ends with him not playing. Confidence: **Medium-Low** — idle-finish caveat (fix C).
Playoffs 26: n/a. Prior: none. Cross-season: n/a.
Vs consensus: 75 behind #265.

**Cody Williams (UTA) · cons #293 · age 22 · 66 GP** — window #400→#334 (+66)
Concerns: none major. Confidence: **Medium-High**.
Playoffs 26: n/a. Prior: 2025 50 GP · #470. Cross-season: 470→334 — meaningful year-2 progress from a very low base.
Vs consensus: 41 behind #293.

**Climbing — group verdict.** The healthiest directional tag — dominated by young players closing on dynasty consensus (Flagg, Edgecombe, Queen, Bailey), which is exactly the story the site wants to tell. Weak spots are the familiar ones: trailing-absence players whose "climb" is frozen (Sharpe, Braun, Niederhauser) and starved start points inflating the print (Garland +107, Jakucionis +81).

---

## Part 3 — Re-calibrated recommendations

> **Implementation status (2026-07-11): R1–R17 approved by Ash and implemented** in `trend-insight.ts` (+ plumbing in `roster-live-data.ts`, `player-trend-chart.tsx`, `roster-app.tsx`, `player-compare-card.tsx`), noting the R16→R7 and R15→R6 dependencies. Verified against live data: 89 of the 211 sampled players changed tags, all in the directions recommended below (Turner→stable, Harper→climbing, Coby White→fading, Markkanen/JJJ→games-limited, Cam Johnson re-joined at #158, all 999-consensus directional tags suppressed). New taxonomy counts: regressing 65, stable 63, games-limited 59, surging 37, outproducing 23, climbing 22, fading 19, small-sample 17, aging-decline 15, developing 12, breaking-out 12, cratering 6, plunging 5, washed 1, no-tag 18. **D1 and D2 approved and implemented (2026-07-11):** D1 — `parseDob()` in `scripts/nba-data/roster_ingest.ts` never matched the sheet's 2-digit-year `MM/DD/YY` format, so `nba_roster.dob` was silently NULL for all 579 players and every age on the site ran off the coarser `age_at_ingest` fallback; fixed with a century-pivot parse (YY≥50→19YY, else 20YY) plus Stephon Castle's source-CSV typo (`11/01/01`→`11/01/04`, confirmed Nov 1 2004 via public sources). Re-ingested live: 0 of 579 `nba_roster` rows now have a null `dob`; Castle now reads age 21 in prod. D2 — the postseason build filter in `scripts/build-player-trends.ts` used the same `g>10 & mpg>10` floor as the regular season, dropping every 6–9-game playoff run from `nba_player_trends` before `deriveFinalTake()`'s 6-GP rider ever saw the data; postseason now uses its own `g>5` (6+ games), no minutes floor, per Ash's call to key this on games played alone. Rebuilt and pushed live: postseason coverage went 56→154 players; Marcus Smart's 10-game playoff run (previously invisible) now correctly appends "across 10 playoff games he was a clearly better player than his regular-season line" to his card. Regular-season build (437 players, `g>10 & mpg>10`) is unchanged.

### 3.1 Rule changes (fix classes, not individual players)

- **R1 — Suppress gap-based tags when consensus is the 999 fallback.** 45 of 374 tagged players (12%) carry tags and blurbs anchored to "#999 consensus rank," which prints on cards. Show no tag (or an availability/sample tag only) when the dynasty join misses. Fixes ~13 sampled cards outright.
- **R2 — Fix the dynasty name-join for Cameron Johnson** (and audit for other alias misses — likely "Cam Johnson" in `dynasty-rankings.json` vs "Cameron Johnson" in `nba_roster`). He is a top-150 asset currently tagged against #999.
- **R3 — Start-point guard.** Require a minimum cumulative games sample at the window's start block (suggest ≥ 15 GP by the first charted block, else slide the start forward to the first block that qualifies). Kills the fake −120/+160 moves (Coby White #3-after-one-game, Herro's 4-game #15, GG Jackson, Raynaud, Garland).
- **R4 — Trailing-absence rule.** If the last 3+ blocks are stale, route to INJURY-LIMITED (or append an "idle since <date>" caveat and drop the directional arrow). Eleven sampled players sit at exactly 4/12 stale — one under the 0.35 gate — while wearing directional tags (Markkanen SURGING, JJJ BREAKING-OUT, Simons FADING, Hunter PLUNGING, Sharpe CLIMBING…). Alternatively/additionally lower `INJURY_STALE_SHARE` to 0.33.
- **R5 — Sign-aware plunge/crater copy.** In the near-band, when `gapNow ≤ 0` (finishing at or above consensus), never print "crashed/collapsed to #X" — use regression-to-market copy instead. Affected: Mikal Bridges, Miles Bridges, Mitchell, Grimes, James, Peavy, Mann, Knecht.
- **R6 — Rookie-aware gate.** For first-year players (draft_year == current season), dynasty consensus prices upside, so below-consensus tags measure the dynasty discount, not decline. Route rookies away from CRATERING/FADING toward CLIMBING/"DEVELOPING" framing unless production is *also* declining steeply in absolute terms. Ten of twelve CRATERING players are ≤ 23.
- **R7 — Aging-decline epsilon + recency.** Require a minimum per-season decline (suggest ≥ 0.05 Minus1V) so 0.68→0.68 (Turner) and 0.10→0.04→−0.01 (Kennard) don't trigger; require the most recent season (healthy or not) to be non-improving so live rebounds (Nurkic +0.39, Anderson +0.16) block the tag; and fix the blurb's "this year" when the cited minutes drop is from a prior season.
- **R8 — Two-sided injury-limited blurb + neutral label for call-ups.** When the small-sample rank is *better* than the player's consensus/history, say the rank may be inflated by a hot short sample (Jerome #48, Slawson #122, Mbeng #121); and for two-way/late-call-up usage patterns say "limited sample," not injury language (McClung, Leons, Dennis, DeAndre Jordan).
- **R9 — In-season rider on aging-decline.** When the charted window *improved* ≥ 20 spots, append it ("though he closed this season strong: #230→#165") so the card doesn't contradict its own chart (Portis, Horford, Lopez).
- **R10 — Playoff-rider audit.** Several qualifying playoff surges produced no rider (Marcus Smart #30/10 GP, Tari Eason #20/6 GP, Ayo Dosunmu #40/10 GP, LeVert #109/13 GP, Grimes, Shannon). Verify the ≥ 0.3 z-jump threshold isn't too strict relative to rank movement, and consider your 6-GP/10-MPG gate replacing the current 4-GP bar. Also soften the *downward* rider when the playoff rank is still elite (Maxey #13: "fell well short" reads wrong).
- **R11 — (Superseded by R14)** Originally: soften SURGING copy for flat cases. Promoted to a full tag split in R14 below.

### 3.1b Taxonomy changes — splits & renames (added after review discussion)

- **R12 — Rename INJURY-LIMITED → "GAMES-LIMITED".** More accurate (the gate measures games, not injuries) and honest for the non-injury cases (McClung, DeAndre Jordan). Standalone — no logic change; label + blurb noun only.
- **R13 — Split GAMES-LIMITED into two tags: GAMES-LIMITED (injury pattern) vs SMALL SAMPLE (call-up pattern).** Heuristic for the SMALL SAMPLE branch: games concentrated in the final 2–3 blocks + little/no prior-season track record (two-ways, late-season auditions — Mbeng, Slawson, Malachi Smith, McClung, Leons, KJ Simpson). Tatum missing 60 games is a health question; Mbeng playing 15 April games at 32 MPG is an evaluation question with an inflated rank — different stories deserve different labels. Pairs with R8's two-sided blurb.
- **R14 — Split SURGING into SURGING (trend ≥ +10, genuinely rising) vs OUTPRODUCING (|trend| < 10, flat above consensus).** Two populations currently share one 📈 label: true climbers (Durant, NAW, Queta) and flat players parked above a stale market rank (Sexton, LaRavia, Landale). Flat-above-consensus is a market-rank signal, not a player trend, and the copy should say so.
- **R15 — New DEVELOPING tag for first-year players (implements R6's rookie gate).** Rookies below their dynasty consensus get DEVELOPING (neutral-to-positive framing, cites the dynasty discount) instead of FADING/CRATERING, unless production is also collapsing in absolute terms. CRATERING then stays exclusively for established players (Gradey Dick, Kolek), where it's excellent. Cooper Flagg's CLIMBING card is the template for what a rookie card should feel like.
- **R16 — "WASHED" as a stricter tier above AGE DECLINE (not a rename).** Straight renaming aging-decline → WASHED is risky while the tag still misfires (Turner triggered on 0.68→0.68; Nurkić/Anderson while rebounding) and while ~half its cohort still outproduces consensus (DeRozan +88 spots, McCollum #79 in the playoffs) — "washed" reads as "worthless now" and would contradict the card's own numbers. Instead: **R7 (epsilon + recency) is a prerequisite**, then split the tier — ⏳ AGE DECLINE stays for decliners who are still assets (DeRozan, Klay, Draymond); **WASHED** requires age ≥ 33 AND three consecutive real declines (≥ 0.05 Minus1V each) AND current production below ~#250. In this sample that tier is roughly Conley/Capela-type cases where nobody would argue.
- **R17 — (Optional, copy-only) REGRESSING copy split.** Distinguish "cooling off a hot start" (Barlow, Porter Jr., Huerter — often career-best seasons) from "genuinely declining" (Patrick Williams) in the blurb wording, without adding a new tag. Heuristic: if season-long value ≥ both prior seasons', use the hot-start framing.

### 3.2 Per-player tag re-calibrations

Where a rule change above already fixes the card, the player is listed under that rule rather than duplicated. These are the individual designations I'd change today:

| # | Player | Current | Recommended | Why |
|---|--------|---------|-------------|-----|
| P1 | Myles Turner | aging-decline | **stable** | Trigger is sub-rounding-error decline; 9-cat/8-cat both stable; tracking consensus exactly |
| P2 | Luke Kennard | aging-decline | **surging** (outproducing) | Epsilon declines; 79 GP; holding above #292 consensus |
| P3 | Terance Mann | aging-decline | **regressing** | −0.02 "decline" step; above consensus and drifting down is the real read |
| P4 | Andre Drummond | aging-decline | **regressing** | 2026 improved on 2025; monotone-decline premise fails with recency |
| P5 | Jusuf Nurkic | aging-decline | **injury-limited** | Idle last 4 blocks; 2026 value rebounded; blurb's minutes claim mislabeled |
| P6 | Kyle Anderson | aging-decline | **stable / no tag** | Current season rebounded; consensus is 999 fallback |
| P7 | Dorian Finney-Smith | aging-decline | **injury-limited** | 37 GP, missed first 4 blocks; epsilon decline; consensus 999 |
| P8 | Lauri Markkanen | surging | **injury-limited** | Zero games in last 3 blocks; "holding well above" describes an absent player |
| P9 | Jaren Jackson Jr. | breaking-out | **injury-limited** | Zero games in last 3 blocks; climb was real but season ended in February |
| P10 | Brandon Miller | breaking-out | **surging/stable** | +52 is cold-start recovery to his established level (#63 → #53) |
| P11 | GG Jackson | breaking-out | **climbing** (copy re-anchored) | +159 print is a starved start; real story is "healthy again, back to 2024 form" |
| P12 | Leonard Miller | breaking-out | **no tag / limited sample** | 46 GP at 15.7 MPG; surge concentrated in April minutes |
| P13 | Tyler Herro | plunging | **injury-limited** | Start rank from a 4-game block; 4/12 stale |
| P14 | De'Andre Hunter | plunging | **injury-limited** | Zero games in last 4 blocks |
| P15 | Isaiah Hartenstein | plunging | **injury-limited** | 47 GP; slide entangled with absences; playoffs back at level (#57) |
| P16 | Aaron Nesmith | plunging | **injury-limited** | 45 GP scattered; form/absence entangled |
| P17 | Davion Mitchell | plunging | **stable** | Career-best year, finished ahead of consensus; tag inverts his arc |
| P18 | Sion James | plunging | **stable** | 82 GP, landed 5 spots off consensus; hot start normalized |
| P19 | Micah Peavy | plunging | **stable** | Finished ahead of consensus (#401 vs #411) |
| P20 | Mikal Bridges | plunging | **regressing** (copy fix) | Real cool-down but finished above consensus; "crashed" is sign-blind |
| P21 | Miles Bridges | plunging | **regressing** (copy fix) | Finished 1 spot ahead of consensus |
| P22 | Quentin Grimes | plunging | **regressing** (copy fix) | Settled at market level after hot start; playoff riser |
| P23 | Coby White | cratering | **fading** | Start rank was #82 on ~9 games (cum #3 after one game); honest move ≈ −20 |
| P24 | Dylan Harper | cratering | **climbing / developing** | Rookie vs dynasty consensus; #61 across 23 playoff games — most recent form is strong |
| P25 | Tre Johnson | cratering | **fading** (rookie framing) | Dynasty discount, normal rookie wall |
| P26 | Drake Powell | cratering | **fading** (rookie framing) | Start-point inflation + dynasty discount |
| P27 | Alex Sarr | fading | **injury-limited** | 48 GP, near-empty run-in; YoY he leapt 141→56 |
| P28 | Ivica Zubac | fading | **injury-limited** | Late-season absence drove the slide |
| P29 | Anfernee Simons | fading | **injury-limited** | Zero games in last 3 blocks |
| P30 | Jordan Poole | fading | **injury-limited** (or caveat) | 39 GP; availability season, though YoY decline is real |
| P31 | Devin Carter | fading | **injury-limited** | 38 GP, 4/12 stale |
| P32 | Alperen Sengun | fading | **stable** | Career-best season one band-edge from STABLE; #21 playoff run |
| P33 | Stephon Castle | fading | **stable** (consensus-ahead copy) | Sophomore leap (292→111) + #35 across 23 playoff games; also fix roster DOB (shows 26, is 21) |
| P34 | Egor Demin | fading | keep, add idle caveat | Rookie, finish frozen (0/0 final blocks) |
| P35 | Giannis Antetokounmpo | stable | keep, add 36-GP caveat | 4/12 stale; fine either way |
| P36 | Shaedon Sharpe | climbing | **injury-limited / idle caveat** | Barely played after block 7 |
| P37 | Christian Braun | climbing | **injury-limited** | 44 GP; both endpoints noisy; healthy level top-100 |
| P38 | Marcus Smart | regressing | keep tag; **flag consensus** | #303 consensus vs #189 season + #30 playoffs — market rank stale |
| P39 | Svi Mykhailiuk | regressing | keep, add idle caveat | Fringe; barely played after block 7 |
| P40 | Caleb Love | regressing | keep, add idle caveat | Same trailing-absence decay |
| — | Keaton Wallace, Quenton Jackson, Kris Murray, Kenrich Williams, Jabari Walker, Micah Potter, Branden Carlson, Malachi Smith (+37 unsampled) | various | **suppress via R1** | consensus-999 fallback |
| — | Cameron Johnson | surging (#999) | **re-derive via R2** | name-join bug |

### 3.3 Consensus-rank review candidates (not tag changes)

The tag engine repeatedly flagged these as >85 spots better than their market rank across a full season — the input consensus looks stale: **Marcus Smart (#303 vs #189/#30 playoffs), Neemias Queta (#173 vs #60), Justin Champagnie (#291 vs #174), Julian Champagnie (#228 vs #140/#53 playoffs), Isaac Okoro (#397 vs #268), Jock Landale (#389 vs #220), Bobby Portis (#281 vs #165), Al Horford (#320 vs #147), Brook Lopez (#385 vs #209)** — the last three are aging players where the discount may be deliberate.

### 3.4 Data-quality items found in passing

- **D1 — Stephon Castle's DOB in `nba_roster`** yields age 26; he's 21. Affects the aging gate only at 30+, but worth fixing.
- **D2 — Postseason trends coverage**: `nba_player_trends` postseason has 56 players (display filter g>10 & mpg>10 excludes 6–10-game playoff runs). The playoff ranks in this audit came from `season_player_values` instead; if the postseason rider should reach more cards, the postseason display filter needs its own thresholds (e.g. your 6-GP/10-MPG gate).

*Prepared by Claude Code · data pulled 2026-07-11 · script: `scripts/tmp-trend-tag-audit.ts` (temporary, not committed)*
