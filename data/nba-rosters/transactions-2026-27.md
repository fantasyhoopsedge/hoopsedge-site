# 2026-27 roster transactions (overlay on the screenshot snapshots)

Trades/signings that post-date the cap-sheet screenshots are logged here and
applied on top of `2026-27.csv`. Screenshots stay as the base snapshot; this log
is the audit trail for every manual override. `new_to_team` follows automatically
(prior_team = the player's 2025-26 team, which differs from his new team).

| date | source | move | status |
|------|--------|------|--------|
| 2026-06-30 | Shams Charania (ESPN) | **Ja Morant** → POR (from MEM) | ✅ applied |
| 2026-06-30 | Shams Charania (ESPN) | **Jerami Grant** → MEM (from POR) | ✅ applied |
| 2026-06-30 | Shams Charania (ESPN) | **Kris Murray** → MEM (from POR) | ✅ applied |
| 2026-07-04 | ATL cap sheet refresh | **Devin Carter** → ATL (from SAC) | ✅ applied |
| 2026-07-04 | ATL cap page (option declined) | **Jonathan Kuminga** → UFA (ATL declined 2026-27 club option 6/29/26) | ✅ removed, stays OFF all rosters |
| 2026-07-04 | BOS cap sheet refresh | **Paul George** → BOS (from PHI) | ✅ applied |
| 2026-07-04 | BOS cap sheet refresh | **Mike Conley Jr.** → BOS (from MIN) | ✅ applied |
| 2026-07-04 | BOS cap sheet refresh | **Mitchell Robinson** → BOS (from NYK) | ✅ applied |
| 2026-07-04 | BOS→PHI (confirmed) | **Jaylen Brown** → PHI (from BOS); **Paul George** BOS←PHI = the swap | ✅ applied both sides |
| 2026-07-04 | BOS cap sheet refresh | **Max Shulga** → off BOS (waived or traded, TBD) | ⚠️ removed from BOS, destination unknown |

**Note:** Trade fully reconciled. The updated post-trade Memphis cap sheet
confirmed Grant + Murray on MEM (prior_team = Portland Trail Blazers) and Morant
removed. All three pieces now correct in `2026-27.csv`.

**2026-07-04 ATL refresh:** Updated ATL screenshot shows Devin Carter (from SAC)
and Jock Landale added; Jonathan Kuminga gone (his alphabetical slot is now
Landale). **Kuminga clarified via his cap page:** ATL DECLINED the 2026-27 club
option (deadline 6/29/26, declined 6/29/26) — the back year of his 2yr/$46.8M
deal — so he is an UNSIGNED 2026-27 UFA, NOT part of a Carter sign-and-trade.
Carter's SAC→ATL arrival is a separate move. Kuminga is REMOVED from the ATL rows
and stays OFF all rosters until he signs somewhere. ⚠️ DB caveat: ingest upserts
on (season, norm_name) and does NOT delete, so Kuminga's stale ATL row will
persist in `nba_roster` and will NOT self-heal (he won't reappear under a new
team) — it needs a MANUAL delete:
`delete from public.nba_roster where season='2026-27' and norm_name='jonathan kuminga';`
Also updated: CJ McCollum contract 1yr/$30.7M→$21M; Henri Veesaar signed
4yr/$9.3M (FA 2029 +1).

**2026-07-04 BOS refresh:** Big Boston reshape. Added Paul George (from PHI,
4yr/$212M), Mike Conley Jr. (from MIN, 1yr min), Mitchell Robinson (from NYK,
3yr/$47.4M). ⚠️ **Jaylen Brown GONE from the BOS roster** (5yr/$285M deal — he's
traded, not a FA, so he WILL re-home when his new team's screenshot lands via
upsert on norm_name; destination unconfirmed). Max Shulga also gone (waived or
traded, TBD). Both need the same manual-delete caveat as Kuminga IF they turn out
to be off all rosters:
`delete from public.nba_roster where season='2026-27' and norm_name in ('jaylen brown','max shulga');`
(only run for whichever does NOT reappear on another team). Contract updates:
Neemias Queta re-signed 4yr/$56.5M (FA 2031); Baylor Scheierman $12.3M→$12.8M;
Amari Williams standard→Two-Way; Ron Harper Jr. salary $2.63M added; Dillon
Mitchell tagged "2nd Rd Pick"; Banton & Walsh FA notation "2026 +1"→"2027".

**2026-07-04 PHI refresh:** Jaylen Brown ↔ Paul George swap confirmed (George now
on BOS, Brown now on PHI). PHI also added Ariel Hukporti (from NYK, 1yr/$3.4M),
Caleb Love (from POR, Two-Way), Rayan Rupert (from MEM, Two-Way — his MEM row was
REMOVED to avoid a duplicate key; self-heals via norm_name upsert), Anfernee
Simons (from CHI, 2yr/$12.3M), Dean Wade (from CLE, 4yr/$39M). Note: Hukporti/
Love/Simons/Wade were NOT previously in the CSV under their old teams, so no
duplicate cleanup was needed for them. Contract/data fixes: Johni Broome
4yr/$7.8M→$8.7M + draft 2025-23→2025-35 + birthplace AL→FL (Plant City);
**name typo Laborn→Labaron Philon Jr.** (draft 2026-ND→2026-22, +jersey 00) —
⚠️ norm_name changed, so the old 'laborn philon jr' DB row is now orphaned and
needs a manual delete:
`delete from public.nba_roster where season='2026-27' and norm_name='laborn philon jr';`
Also: Jabari Walker 3yr→2yr (age 24.93→23.94 fix); Dominick Barlow salary
$3.413M→$3.415M.

**2026-07-04 BKN refresh:** Added Keon Ellis (from CLE, 2yr/$18M), Moritz Wagner
(from ORL, 2yr/$19M). Removed (destination TBD): Ochai Agbaji, Tyson Etienne,
Ziaire Williams, Jalen Wilson — all RFA/depth, off the BKN sheet. Fixes: Chaney
Johnson RFA→Two-Way; Josh Minott salary $4.33M added; Day'Ron Sharpe salary
$9.62M added; Malachi Smith FA "2026 +1"→"2027"; jerseys added (Bilodeau 34, Dion
Brown 33, Humrichous 12).

**2026-07-04 CHA refresh:** Added Dorian Finney-Smith (from HOU, 4yr/$52.7M — his
HOU row was REMOVED to avoid a duplicate key; self-heals via norm_name upsert).
Fixes: Pat Connaughton FA "2026 +1"→"2027"; Coby White salary $22.84M added.

**2026-07-04 CHI refresh:** Added Zach Collins (returning — 2025-26 team already
CHI, was simply missing from the CSV; NOT new_to_team) and Norman Powell (from
MIA, 2yr/$45M). Removed (destination TBD): Kam Jones (was IND→CHI, now off).
Ellis/Wagner/Collins/Powell were NOT previously in the CSV, so no duplicate
cleanup needed for them (and no DB orphan — they were never ingested).

**2026-07-04 CLE refresh:** Added Thomas Bryant (returning — 2025-26 team already
CLE, was missing from CSV; NOT new_to_team, 1yr/$3.5M). Fixes: Meleek Thomas
rookie deal signed (4yr/$9.3M, FA 2029 +1, +jersey 15); jerseys added (Agee 46,
Udeh Jr. 39). Note: Keon Ellis (added to BKN from CLE) was never in the CSV, so
no CLE removal needed.

**2026-07-04 DAL refresh:** No roster moves. Fixes: **name typo Ischenko→Ishchenko**
(Vsevolod, +jersey 13, pos G→F, contract "2nd Rd Pick") — ⚠️ norm_name changed,
old 'vsevolod ischenko' DB row orphaned, needs delete; Ryan Nembhard FA "2026 +1"
→"2027"; **PJ Washington 4yr/$90M→$88.8M + FA 2028→2030**; de Larrea +jersey 55.

**2026-07-04 DEN refresh:** Added Marvin Bagley III (from DAL, 1yr/$3.5M — was NOT
in the CSV, no dup cleanup). Removed (dest TBD): Jalen Pickett (off DEN). Fixes:
Trevon Brazile & Bryce Hopkins contract blank→"2nd Rd Pick". (Bagley HT read as
6'01" on sheet — corrected to 6'11", he's a 235-lb #2-pick big.)

**2026-07-04 DET refresh:** Added John Collins (from LAC, 3yr/$51M), plus two
returning players missing from the CSV — Javonte Green (1yr/$4M) and Kevin Huerter
(3yr/$27M), both 2025-26 team = DET (NOT new_to_team). Fixes: Daniss Jenkins &
Tolu Smith III FA "2026 +1"→"2027"; Ugonna Onyenso blank→Two-Way; jerseys added
(Drake Allen 29, Jaden Henley 39, Onyenso 34, Corey Stephenson 47).

**2026-07-04 GSW refresh:** Added Kristaps Porzingis (returning — 2025-26 team GSW,
was missing from CSV; 2yr/$40M, NOT new_to_team). Removed (dest TBD): Pat Spencer.
Fixes: **De'Anthony Melton re-signed 2yr/$11M (FA 2028, was 2yr/$6.5M)**; Al
Horford salary $5.97M→$6.82M; Lajae Jones blank→"2nd Rd Pick".

**2026-07-04 HOU refresh:** Added Bogdan Bogdanovic (from LAC — LAC row REMOVED;
note his deal changed to 1yr/$3.9M min) and Marcus Smart (from LAL — LAL row
REMOVED; deal now 2yr/$13M). Both self-heal via norm_name upsert. Fixes: **Tari
Eason signed 5yr/$81.5M (FA 2030 +1, was RFA)**; JD Davison FA "2026 +1"→"2027";
Bruce Thornton blank→"2nd Rd Pick" (+jersey 3). (DFS already moved to CHA earlier
this session.)

**2026-07-04 IND refresh:** Added Kelly Oubre Jr. (from PHI, 2yr/$17M). Fixes:
Braden Smith blank→"2nd Rd Pick"; jerseys added (Keita 13, Lipsey 14, Mast 51,
Reeves Jr. 16).

**2026-07-04 LAC refresh (major teardown):** Added Gradey Dick & Brandon Ingram
(both from TOR — TOR rows REMOVED). Removed (dest TBD): **Kawhi Leonard**
(3yr/$150M — traded, self-heals), **Bradley Beal** (2yr/$11M), Nicolas Batum
(2yr/$11.5M), Norchad Omier (RFA). Fixes: Jordan Miller re-signed 3yr/$15.3M (FA
2029, was 2yr/$3.2M); Kobe Sanders 2yr/$2.6M→4yr/$11.2M (FA 2029 +1); Brook Lopez
FA "2026 +1"→"2027"; Nick Martinelli blank→Two-Way; Baba Miller & Narcisse Ngoy
blank→"2nd Rd Pick".

**2026-07-04 LAL refresh (major retool):** Added Quentin Grimes (from PHI,
4yr/$60M), Jaden Hardy (from WAS — WAS row removed), Walker Kessler (from UTA —
UTA row removed; re-signed 4yr/$130M, was RFA), Sandro Mamukelashvili (from TOR,
4yr/$52M), Collin Sexton (from CHI, 2yr/$19M). Removed (dest TBD): **Deandre
Ayton** (2yr/$16.2M), Nick Smith Jr. (2yr/$2.5M). Fix: Austin Reaves salary
$41.24M added. Dick/Ingram/Kessler/Hardy all self-heal via norm_name upsert.

**2026-07-04 MEM refresh:** No roster moves (Grant & Murray already on MEM from the
Morant trade — confirmed present in this screenshot). Fixes: GG Jackson II FA
"2026 +1"→"2027"; Ty Jerome salary $9,220,003→$9,220,050; Richie Saunders
blank→"2nd Rd Pick".

**2026-07-04 MIA refresh:** Added Simone Fontecchio (returning — 2025-26 team MIA,
was missing from CSV; 1yr/$2.6M) and Tim Hardaway Jr. (from DEN, 1yr/$6.5M). Fix:
Ryan Conwell rookie deal signed (3yr/$6.3M, FA 2028 +1).

**2026-07-04 MIL refresh:** Added Bogoljub Markovic (2025-draft-and-stash arriving
from Mega Basket/overseas, 4yr/$9.3M — NOT new_to_team). Removed (dest TBD): Andre
Jackson Jr. (4yr/$7.4M), Pete Nance (3yr/$5.7M). Fixes: **Ousmane Dieng re-signed
3yr/$17.5M (FA 2029, was RFA)**; Taurean Prince FA "2026 +1"→"2027"; Malique Lewis
blank→"2nd Rd Pick" (+jersey 19); Jakucionis +jersey 6.

**2026-07-04 MIN refresh:** Added Bones Hyland (1yr/$2.8M — re-signed with MIN per
owner, so prior_team = Minnesota Timberwolves, NOT new_to_team) and Trey Lyles
(from Real Madrid/overseas, 1yr/$3.9M). Removed (dest TBD): Julian Phillips
(4yr/$8.1M). Fixes: Jaylen Clark salary $3.09M added; Ayo Dosunmu salary $19.31M
added; Isaiah Evans blank→"2nd Rd Pick".

**2026-07-04 NOP refresh:** Added DeAndre Jordan (returning — 2025-26 team NOP,
missing from CSV; 1yr/$3.9M). Removed (dest TBD): Trey Alexander (RFA). Fixes:
Melvin Council Jr. blank→Exhibit 10; Jaron Pierre Jr. blank→"2nd Rd Pick"
(+jersey 10).

**2026-07-04 NYK refresh:** Added Andre Drummond (from PHI, 1yr/$3.9M). Fixes:
**name typo Jock Kayli→Jack Kayil** (⚠️ norm_name changed, old row orphaned →
delete); Jose Alvarado jersey 1→5 + draft 2023→2021-ND + salary $4.5M; Mohamed
Diawara draft 2025-31→2025-51 + contract 2yr→4yr/$10M (FA 2030) + salary $2.23M;
Kevin McCullar Jr. draft 2024-24→2024-56; **Karl-Anthony Towns 4yr/$210M→$220M**.

**2026-07-04 OKC refresh:** Added Kenrich Williams (returning — 2025-26 team OKC,
missing from CSV; 1yr/$5M). Removed (dest TBD): Branden Carlson (RFA), Payton
Sandfort (Two-Way). Fixes: Brooks Barnhizer RFA→Two-Way; Isaiah Hartenstein
salary $25.3M→$28.5M; Jared McCain salary $4.4296M→$4.4226M; Ajay Mitchell
2yr→3yr/$8.7M (salary $2.85M); **Cason Wallace DOB 02/26/05→11/07/03 + salary
$5.42M→$7.42M**; jerseys added (Josh Dix 21, Nate Johnson 31, Lamar Wilkerson 42).

**2026-07-04 ORL refresh:** Added 3 returning/new: Jevon Carter (returning ORL,
1yr/$3.5M), Jonathan Isaac (returning ORL, 1yr/$3.5M), Nikola Vucevic (from BOS,
1yr/$3.9M). Fixes: Paolo Banchero 5yr/$232M→$239M; Anthony Black draft
2023-08→2023-06; Colin Castleton RFA→Two-Way; Izaiah Nelson "2nd Rd Pick"→Two-Way
(+jersey 25); Malik Reneau +jersey 42.

**2026-07-04 PHX refresh:** Added Luke Kennard (from LAL, 2yr/$13M) and **Pat
Spencer (self-heal from GSW** — his GSW removal earlier this session now resolves;
he's on PHX). Fixes: **name typos Corey Clipper→Corey Camper Jr. and Sam Hoberg→Sam
Hoiberg** (⚠️ both norm_name changes → orphans, delete); Koby Brea draft
2023-41→2025-41; Jordan Goodwin salary $5.86M added; Mark Williams salary $11.73M
added.

**2026-07-04 POR refresh:** Added **Branden Carlson (self-heal from OKC** — his OKC
removal earlier now resolves; on POR 1yr/$2.4M) and Robert Williams III (returning
POR, 3yr/$44M). Ja Morant confirmed on POR (from the Morant trade). No other
changes.

**2026-07-04 SAC refresh:** Added Precious Achiuwa (returning SAC, 2yr/$11.5M),
Adam Flagler (from Austin Spurs/G-League, Two-Way), Jonathan Mogbo (from TOR,
Two-Way). Fix: Killian Hayes draft 2020-40→2020-07.

**2026-07-04 SAS refresh:** Added Tobias Harris (from DET, 2yr/$31M). Fixes:
**name typos Malik Brown→Maliq Brown (+wt 225→215, birthplace Chesapeake→Culpeper)
and Jayden Quantance→Jayden Quaintance** (⚠️ both norm_name changes → orphans,
delete); Harrison Barnes salary $8M added; Carter Bryant salary $5.514M→$5.145M;
**Stephon Castle YOS 7→2** (was clearly wrong for a 2024 draftee); Julian
Champagnie salary $15.35M added; Tarris Reed Jr. contract $15.3M→$15.8M.

**2026-07-04 TOR refresh:** Added Kyle Anderson (from MIN, 1yr/$3.9M) and **Kawhi
Leonard (self-heal from LAC** — his LAC removal earlier now resolves; on TOR
3yr/$150M). Gradey Dick & Brandon Ingram already removed earlier (→LAC), so no
re-adds. No other changes.

**2026-07-04 UTA refresh:** Added Jaxson Hayes (from LAL, 2yr/$12M). Walker Kessler
already removed earlier (→LAL). Fix: Jusuf Nurkic salary $10.58M added.

**2026-07-04 WAS refresh:** Added **Deandre Ayton (self-heal from LAL** — his LAL
removal earlier now resolves; on WAS 2yr/$16.2M) and Jamir Watkins (returning WAS,
Two-Way). Removed (dest TBD): Leaky Black (Two-Way). Jaden Hardy already removed
earlier (→LAL). Fix: Trae Young salary $49.49M added.

**Self-heals confirmed this session:** Pat Spencer GSW→PHX, Branden Carlson
OKC→POR, **Kawhi Leonard LAC→TOR, Deandre Ayton LAL→WAS** — all were "dest TBD"
and are now placed, so they DON'T need deletes.

**Pending manual DB deletes (owner will run after all teams done):**
```sql
delete from public.nba_roster where season='2026-27' and norm_name in (
  'jonathan kuminga',      -- ATL declined option → UFA
  'laborn philon jr',      -- PHI name-typo fix → replaced by 'labaron philon jr'
  'vsevolod ischenko',     -- DAL name-typo fix → replaced by 'vsevolod ishchenko'
  'jock kayli',            -- NYK name-typo fix → replaced by 'jack kayil'
  'corey clipper jr',      -- PHX name-typo fix → replaced by 'corey camper jr'
  'sam hoberg',            -- PHX name-typo fix → replaced by 'sam hoiberg'
  'malik brown',           -- SAS name-typo fix → replaced by 'maliq brown'
  'jayden quantance',      -- SAS name-typo fix → replaced by 'jayden quaintance'
  'max shulga',            -- off BOS, dest TBD (twin Jaylen Brown self-healed → PHI)
  'ochai agbaji','tyson etienne','ziaire williams','jalen wilson', -- off BKN, dest TBD
  'kam jones',             -- off CHI, dest TBD
  'jalen pickett',         -- off DEN, dest TBD
  'nicolas batum','bradley beal','norchad omier', -- off LAC, dest TBD (Kawhi self-healed → TOR)
  'nick smith jr',         -- off LAL, dest TBD (Ayton self-healed → WAS)
  'andre jackson jr','pete nance', -- off MIL, dest TBD
  'julian phillips',       -- off MIN, dest TBD
  'trey alexander',        -- off NOP, dest TBD
  'payton sandfort',       -- off OKC, dest TBD
  'leaky black'            -- off WAS, dest TBD
);
-- NOTE: self-healed onto new teams this session (NO delete needed): pat spencer
-- (GSW→PHX), branden carlson (OKC→POR), kawhi leonard (LAC→TOR), deandre ayton
-- (LAL→WAS). Jaylen Brown (BOS→PHI) also self-healed.
```
⚠️ Only delete the "dest TBD" names for players who do NOT reappear on a later
team's screenshot (a re-home overwrites their row automatically). Re-check this
list once all 30 teams are processed.
