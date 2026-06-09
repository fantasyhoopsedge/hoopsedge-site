"use client";
import { useState, Fragment } from "react";
import { SiteNav } from "@/components/site-nav";

// ============================================================
// DRAFT BOARD DATA — UPDATE THIS ARRAY TO CHANGE THE BOARD
// Ratings pulled from dynasty_board_ratings_master.txt
// Last synced: May 17, 2026
// ============================================================
const DRAFT_BOARD = [
  { rank: 1, pick: "1.01", name: "Cameron Boozer", school: "Duke", pos: "F/C", tier: 1, age: 19, ht: '6\'10"',
    pts: "5★", reb: "5★", ast: "4★", stl: "4★", blk: "3★", fg: "5★", ft: "3★", tpm: "4★", to: "3★",
    verdict: "Safest dynasty pick in the 2026 class. Elite PTS, REB and FG% — three category anchors. An elite interior scorer and shooter whose strength and rebounding are the foundation of the profile. The youngest prospect in the draft with unbelievable dominance and feel. In category leagues, this profile wins championships." },
  { rank: 2, pick: "1.02", name: "Darryn Peterson", school: "Kansas", pos: "G", tier: 2, age: 19, ht: '6\'4"',
    pts: "5★", reb: "3★", ast: "2★", stl: "5★", blk: "3★", fg: "2★", ft: "4★", tpm: "5★", to: "2★",
    verdict: "Elite PTS on high volume, elite 3PM and elite STL — three category pillars that combine scoring, shooting and defensive impact. One of the best perimeter defensive profiles in the class. High-volume below-average FG% is the one drag that needs to improve. Dynasty risk goes beyond availability — the shot diet is the NBA translation question." },
  { rank: 3, pick: "1.03", name: "AJ Dybantsa", school: "BYU", pos: "G/F", tier: 2, age: 19, ht: '6\'9"',
    pts: "5★", reb: "4★", ast: "3★", stl: "3★", blk: "2★", fg: "4★", ft: "3★", tpm: "2★", to: "1★",
    verdict: "Led the nation in scoring as a freshman. First freshman since Trae Young in 2018 to lead the country in PPG. Elite PTS on high volume — a primary advantage creator whose scoring juice is the real thing. Draws fouls at high volume. Dynasty runway is enormous at 19." },
  { rank: 4, pick: "1.04", name: "Caleb Wilson", school: "North Carolina", pos: "F", tier: 2, age: 20, ht: '6\'8"',
    pts: "4★", reb: "5★", ast: "3★", stl: "5★", blk: "4★", fg: "5★", ft: "2★", tpm: "1★", to: "3★",
    verdict: "Elite REB, elite STL and elite FG% on volume — three category anchors. One of the best defenders in the class, with the feel and instincts already NBA-ready. Draws fouls at the highest rate in the class — the scoring will come. Season ended early with a broken thumb — cleared for the predraft process." },
  { rank: 5, pick: "1.05", name: "Kingston Flemings", school: "Houston", pos: "G", tier: 3, age: 20, ht: '6\'3"',
    pts: "3★", reb: "1★", ast: "5★", stl: "5★", blk: "2★", fg: "3★", ft: "4★", tpm: "4★", to: "4★",
    verdict: "One of my guys. The most elite playmaking guard in the 2026 class. Elite AST and elite STL — two-way impact built into the profile. A 2.91 AST/TO ratio puts him among the most efficient playmakers in the draft. The defensive potential on top of this makes him genuinely special." },
  { rank: 6, pick: "1.06", name: "Keaton Wagler", school: "Illinois", pos: "G", tier: 3, age: 19, ht: '6\'5"',
    pts: "3★", reb: "3★", ast: "4★", stl: "2★", blk: "2★", fg: "2★", ft: "4★", tpm: "5★", to: "4★",
    verdict: "Elite 3PM — the standout category anchor. An exceptional shooter and processor who thrives in movement. The dynasty case is built on shooting creation." },
  { rank: 7, pick: "1.07", name: "Aday Mara", school: "Michigan", pos: "C", tier: 3, age: 21, ht: '7\'3"',
    pts: "3★", reb: "4★", ast: "3★", stl: "1★", blk: "5★", fg: "5★", ft: "1★", tpm: "1★", to: "3★",
    verdict: "One of my guys. Elite BLK and elite FG% — two genuine category anchors. The most elite shot-blocker in the entire 2026 class by a distance. A true needle-mover at center — the interior presence and rim protection profile is rare at this age." },
  { rank: 8, pick: "1.08", name: "Mikel Brown Jr.", school: "Louisville", pos: "G", tier: 3, age: 20, ht: '6\'5"',
    pts: "4★", reb: "2★", ast: "4★", stl: "4★", blk: "1★", fg: "2★", ft: "4★", tpm: "4★", to: "1★",
    verdict: "A spectacular live-dribble passer and versatile creator with an improved burst and first step — dribble, pass, shoot at an elite level when healthy. Draws fouls at high volume. Lower back injury is the only reason he's not top 5. Predraft medicals are everything." },
  { rank: 9, pick: "1.09", name: "Ebuka Okorie", school: "Stanford", pos: "G", tier: 4, age: 19, ht: '6\'2"',
    pts: "5★", reb: "2★", ast: "3★", stl: "4★", blk: "2★", fg: "2★", ft: "4★", tpm: "4★", to: "4★",
    verdict: "One of my guys. Elite PTS on high volume — gets to the basket more than any guard in the class. Absolutely electric with the best first step in the draft — pure scoring gravity that translates regardless of system. Draws fouls at high volume — the strongest indicator the scoring translates to NBA level." },
  { rank: 10, pick: "1.10", name: "Labaron Philon", school: "Alabama", pos: "G", tier: 4, age: 21, ht: '6\'3"',
    pts: "5★", reb: "2★", ast: "4★", stl: "3★", blk: "1★", fg: "3★", ft: "3★", tpm: "5★", to: "3★",
    verdict: "Elite PTS on high volume and elite 3PM — one of the most underrated scoring profiles in the class. A shifty primary creator with elite rim pressure and trustworthy defensive upside — breaks down defences off the dribble as well as anyone in this class. The dynasty value is higher than the rank suggests." },
  { rank: 11, pick: "1.11", name: "Hannes Steinbach", school: "Washington", pos: "F/C", tier: 4, age: 20, ht: '7\'1"',
    pts: "3★", reb: "5★", ast: "3★", stl: "3★", blk: "4★", fg: "5★", ft: "3★", tpm: "1★", to: "2★",
    verdict: "Elite REB and elite FG% on volume — two genuine category anchors. Best rebounder in the class minute-for-minute. A strong, physical frontcourt presence who brings interior balance and positional strength that complements more rangy lineups." },
  { rank: 12, pick: "1.12", name: "Dailyn Swain", school: "Texas", pos: "F", tier: 4, age: 21, ht: '6\'8"',
    pts: "3★", reb: "4★", ast: "3★", stl: "5★", blk: "2★", fg: "4★", ft: "4★", tpm: "3★", to: "2★",
    verdict: "Elite STL — a class-leading defensive rate. A lengthy wing who brings essential creation against tough, athletic defences — the size and secondary playmaking are the dynasty calling cards. SEC Newcomer of the Year. At 20 years old the dynasty runway is real." },
  { rank: 13, pick: "1.13", name: "Darius Acuff Jr.", school: "Arkansas", pos: "G", tier: 4, age: 20, ht: '6\'1"',
    pts: "5★", reb: "2★", ast: "5★", stl: "1★", blk: "2★", fg: "3★", ft: "4★", tpm: "5★", to: "3★",
    verdict: "Elite PTS, elite AST and elite 3PM on high volume — three category pillars. A 2.97 AST/TO ratio — the most efficient high-volume playmaker in the class. One of the deepest multi-cat elite profiles in the class." },
  { rank: 14, pick: "1.14", name: "Yaxel Lendeborg", school: "Michigan", pos: "G/F", tier: 4, age: 24, ht: '6\'7"',
    pts: "3★", reb: "3★", ast: "3★", stl: "3★", blk: "4★", fg: "3★", ft: "4★", tpm: "5★", to: "4★",
    verdict: "Elite 3PM — a rare shooting profile for a forward of his size. A sizable wing who excels in transition with high-level shooting and passing — a genuine multi-tool forward. Age 23.7 is the dynasty runway concern — the production is real, the timeline is short." },
  { rank: 15, pick: "1.15", name: "Allen Graves", school: "SCU", pos: "G/F", tier: 4, age: 20, ht: '6\'5"',
    pts: "3★", reb: "4★", ast: "3★", stl: "5★", blk: "4★", fg: "3★", ft: "3★", tpm: "4★", to: "4★",
    verdict: "Elite STL — the most elite steal rate in the class. A chaos creator with phenomenal feel — exceptional on the offensive glass with the size and physicality to impact every possession. Historic multi-cat defensive production for a wing. SOS caveat: Santa Clara is not a P6 programme." },
  { rank: 16, pick: "1.16", name: "Cameron Carr", school: "Baylor", pos: "G", tier: 5, age: 22, ht: '6\'5"',
    pts: "3★", reb: "3★", ast: "3★", stl: "2★", blk: "4★", fg: "3★", ft: "4★", tpm: "5★", to: "3★",
    verdict: "Elite 3PM — a class-leading shooting volume profile. An athletic movement shooter who is also an exceptional shot-blocker for a wing — a rare combination of spacing and defensive versatility. NBA translation thesis is built on shooting and shot-blocking." },
  { rank: 17, pick: "1.17", name: "Brayden Burries", school: "Arizona", pos: "G", tier: 5, age: 21, ht: '6\'4"',
    pts: "3★", reb: "3★", ast: "3★", stl: "5★", blk: "1★", fg: "3★", ft: "4★", tpm: "5★", to: "4★",
    verdict: "Elite STL and elite 3PM — two category pillars that punch above the consensus ranking. A reliable, dependable guard — the ideal third option who brings depth and ball-handling stability to any backcourt. Consistent multi-contributor floor." },
  { rank: 18, pick: "1.18", name: "Bennett Stirtz", school: "Iowa", pos: "G", tier: 5, age: 23, ht: '6\'5"',
    pts: "3★", reb: "2★", ast: "4★", stl: "3★", blk: "1★", fg: "3★", ft: "4★", tpm: "4★", to: "3★",
    verdict: "A crafty creator with pull-up shooting and real scoring juice off the dribble — alleviates pressure from primary initiators in a way that doesn't always show in the stat line. Age 22 compresses the dynasty runway but the category floor is real." },
  { rank: 19, pick: "1.19", name: "Christian Anderson", school: "Texas Tech", pos: "G", tier: 5, age: 20, ht: '6\'3"',
    pts: "3★", reb: "2★", ast: "5★", stl: "4★", blk: "1★", fg: "3★", ft: "4★", tpm: "5★", to: "1★",
    verdict: "Elite AST and elite 3PM — two category pillars. The most prolific assist creator in the class and arguably its best shooter — elite pull-up ability and pick-and-roll craft that few guards in this draft can match. Specialist profile." },
  { rank: 20, pick: "1.20", name: "Nate Ament", school: "Tennessee", pos: "F", tier: 5, age: 20, ht: '6\'4"',
    pts: "3★", reb: "3★", ast: "3★", stl: "3★", blk: "3★", fg: "2★", ft: "3★", tpm: "2★", to: "2★",
    verdict: "A gigantic wing with undeniable shotmaking off movement — the strength and physicality to impose himself have improved significantly. Draws fouls at high volume — the scoring has room to grow if the shot diet evolves at NBA level. A development play." },
  { rank: 21, pick: "1.21", name: "Morez Johnson Jr.", school: "Michigan", pos: "F/C", tier: 6, age: 20, ht: '6\'9"',
    pts: "3★", reb: "4★", ast: "2★", stl: "2★", blk: "4★", fg: "5★", ft: "3★", tpm: "1★", to: "3★",
    verdict: "Elite FG% at 62.3% — a genuine category anchor. An explosive athlete with high-level rim protection and interior defence — one of the premier frontcourt defensive prospects in this range. Minutes-suppressed at Michigan. The buy-low case is real." },
  { rank: 22, pick: "1.22", name: "Jayden Quaintance", school: "Kentucky", pos: "C", tier: 6, age: 19, ht: '6\'9"',
    pts: "2★", reb: "4★", ast: "2★", stl: "3★", blk: "5★", fg: "3★", ft: "1★", tpm: "2★", to: "3★",
    verdict: "Elite BLK — a genuine category anchor from scouting context. Special flashes throughout — a slasher, play finisher and secondary passer with massive defensive potential. Only 4 games played due to injury — ratings from scouting, not season stats. The upside is elite. The data isn't there yet." },
  { rank: 23, pick: "1.23", name: "Zuby Ejiofor", school: "SJU", pos: "F/C", tier: 6, age: 22, ht: '6\'10"',
    pts: "3★", reb: "4★", ast: "3★", stl: "4★", blk: "5★", fg: "4★", ft: "2★", tpm: "1★", to: "3★",
    verdict: "Elite BLK — a genuine category anchor. A versatile big who brings utility as a handler and passer — has shown constant improvement at every level. Draws fouls at high volume. Dynasty buy on the rim protection." },
  { rank: 24, pick: "1.24", name: "Karim Lopez", school: "Maine", pos: "F", tier: 6, age: 20, ht: '6\'11"',
    pts: "2★", reb: "3★", ast: "3★", stl: "3★", blk: "3★", fg: "3★", ft: "2★", tpm: "2★", to: "2★",
    verdict: "NBL Next Stars pathway — same programme that produced LaMelo Ball, Josh Giddey and Alex Sarr. A developmental wing with improved shooting and solid ball skills — the physical strength and athleticism for a versatile two-way role are already visible. 6'9\" with 7'1\" wingspan. Youngest wing in the class at 19.0. Pure ceiling bet." },
  { rank: 25, pick: "1.25", name: "Taris Reed Jr.", school: "UCONN", pos: "C", tier: 6, age: 23, ht: '6\'11"',
    pts: "3★", reb: "5★", ast: "3★", stl: "3★", blk: "5★", fg: "5★", ft: "1★", tpm: "1★", to: "3★",
    verdict: "Elite REB, elite BLK and elite FG% at 60.7% — three genuine category anchors. A traditional center who imposes a physical edge and brings size and strength that impacts every possession. NCAA Tournament East Region MOP: 19.5 PPG and 13.2 RPG over 6 games. Age 22.9 compresses the runway." },
  { rank: 26, pick: "1.26", name: "Meleek Thomas", school: "Arkansas", pos: "G", tier: 6, age: 20, ht: '6\'5"',
    pts: "3★", reb: "2★", ast: "3★", stl: "5★", blk: "1★", fg: "2★", ft: "4★", tpm: "5★", to: "4★",
    verdict: "Elite STL and elite 3PM — two category pillars. An excellent complementary player with a unique shotmaking touch — outstanding off-ball defence, movement skills and an innate ability to jump passing lanes. A low-noise, high-value profile." },
  { rank: 27, pick: "1.27", name: "Richie Saunders", school: "BYU", pos: "G", tier: 6, age: 25, ht: '6\'5"',
    pts: "4★", reb: "3★", ast: "3★", stl: "5★", blk: "2★", fg: "3★", ft: "4★", tpm: "5★", to: "3★",
    verdict: "Elite STL and elite 3PM — two category pillars. A hyper-efficient role player with a relentless motor and high-percentage perimeter shooting that translates to any system. The defensive activity and shooting consistency are exactly what contending rosters need. Age 24.3 compresses the dynasty runway but the production is immediate." },
  { rank: 28, pick: "1.28", name: "Isaiah Evans", school: "Duke", pos: "G/F", tier: 6, age: 21, ht: '6\'11"',
    pts: "3★", reb: "2★", ast: "2★", stl: "2★", blk: "3★", fg: "2★", ft: "4★", tpm: "4★", to: "4★",
    verdict: "A tough, physical movement shooter whose grit and competitiveness stand out on tape — shoots more threes per minute than anyone in the class. The dynasty floor rises and falls with three-point shooting." },
  { rank: 29, pick: "1.29", name: "Koa Peat", school: "Arizona", pos: "F", tier: 6, age: 19, ht: '6\'8"',
    pts: "3★", reb: "3★", ast: "3★", stl: "1★", blk: "3★", fg: "4★", ft: "1★", tpm: "1★", to: "3★",
    verdict: "A physical presence with real strength and rebounding — shows flashes of mid-range touch and the ability to impact games through interior physicality. A physicality-and-scoring development play." },
  { rank: 30, pick: "1.30", name: "Henri Veesaar", school: "North Carolina", pos: "F/C", tier: 6, age: 22, ht: '7\'0"',
    pts: "4★", reb: "4★", ast: "3★", stl: "1★", blk: "4★", fg: "5★", ft: "1★", tpm: "4★", to: "3★",
    verdict: "Elite FG% at 60.8% — a 7'0\" stretch big who shot 43% from three on nearly 100 attempts and posted 13 double-doubles. A skilled, mobile center with a soft shooting touch from mid-range and beyond the arc — fits the inside-out template every roster is hunting for. The shooting at his size is the dynasty calling card." },
  { rank: 31, pick: "1.31", name: "Dillon Mitchell", school: "SJU", pos: "F", tier: 7, age: 22, ht: '6\'8"',
    pts: "2★", reb: "4★", ast: "3★", stl: "4★", blk: "4★", fg: "5★", ft: "1★", tpm: "1★", to: "4★",
    verdict: "Elite FG% — finishes everything at the rim and almost never settles for jumpers. A relentless motor on the glass and a surprisingly gifted connective passer for a forward, with an assist-to-turnover ratio that ranked top-15 nationally. The rebounding, steals and efficiency travel. A glue-guy profile that wins category weeks without needing the ball." },
  { rank: 32, pick: "1.32", name: "Ja'Kobi Gillespie", school: "TENN", pos: "G", tier: 7, age: 22, ht: '6\'1"',
    pts: "3★", reb: "2★", ast: "4★", stl: "4★", blk: "2★", fg: "2★", ft: "4★", tpm: "4★", to: "2★",
    verdict: "Set Tennessee's single-season steals record (79) and became the first player in SEC history with 200 assists and 100 made threes in a season. A microwave lead guard with deep range and quick hands, the rare profile that anchors both the assist and steal columns while chipping in triples and free-throw percentage. Size is the NBA question; the category production is not." },
  { rank: 33, pick: "1.33", name: "Ryan Conwell", school: "LOU", pos: "G", tier: 7, age: 22, ht: '6\'4"',
    pts: "4★", reb: "2★", ast: "3★", stl: "3★", blk: "1★", fg: "1★", ft: "4★", tpm: "4★", to: "3★",
    verdict: "One of the highest three-point volumes in the country at nearly 10 attempts per game, paired with a reliable 83% from the line. A pure movement shooter who lives at the rim and beyond the arc, almost never settling for long twos. The shooting gravity and free-throw efficiency are the dynasty anchors. A specialist whose one elite skill is the most portable in the modern game." },
  { rank: 34, pick: "1.34", name: "Joshua Jefferson", school: "ISU", pos: "F", tier: 7, age: 22, ht: '6\'8"',
    pts: "3★", reb: "3★", ast: "5★", stl: "5★", blk: "4★", fg: "3★", ft: "2★", tpm: "3★", to: "3★",
    verdict: "Elite AST and elite STL — a 6'8\", 246-pound point-forward with elite passing, a high basketball IQ and multi-positional defence. The only player in Big 12 history to post 450+ points, 250+ rebounds, 100+ assists, 70+ steals and 25+ blocks in a season. A Denzel Valentine-style stat-stuffer whose all-around production fills every column on the sheet. Few forwards in this class carry this many categories." },
  { rank: 35, pick: "1.35", name: "Chris Cenac Jr", school: "HOU", pos: "C", tier: 7, age: 19, ht: '6\'11"',
    pts: "2★", reb: "4★", ast: "2★", stl: "3★", blk: "2★", fg: "3★", ft: "1★", tpm: "3★", to: "3★",
    verdict: "Led Houston in rebounding as a freshman, the first to do so since 2011-12, with a career-high 18-board NCAA Tournament game. A mobile 6'11\" big with a 7'4\" wingspan who finishes as a lob and roll threat and has flashed three-point range. The youngest player in this tier and the only true freshman — the rebounding floor and developing shooting touch give him the longest dynasty runway of the group." },
  { rank: 36, pick: "1.36", name: "Luigi Suigo", school: "INTL", pos: "F/C", tier: 7, age: 19, ht: '6\'9"',
    pts: "2★", reb: "4★", ast: "2★", stl: "3★", blk: "4★", fg: "4★", ft: "3★", tpm: "3★", to: "3★",
    verdict: "An international forward with a versatile defensive profile — the length and instincts to switch across multiple positions. The offensive development is still early but the defensive tools and rebounding foundation give him a floor to build on. A patient development hold." },
  { rank: 37, pick: "1.37", name: "Baba Miller", school: "MICH", pos: "F", tier: 7, age: 21, ht: '6\'10"',
    pts: "2★", reb: "4★", ast: "2★", stl: "3★", blk: "4★", fg: "4★", ft: "2★", tpm: "2★", to: "2★",
    verdict: "A 6'10\" forward with a 7'1\" wingspan and a wing-like skill set in a big man's body — fluid ball-handling and elite recovery speed have scouts pushing him well into the first round. The physical tools and defensive versatility are rare at his size. The production hasn't matched the physical profile yet — a ceiling play built on the belief that ball skills catch up to the frame." },
  { rank: 38, pick: "1.38", name: "Jaden Bradley", school: "IND", pos: "G", tier: 7, age: 21, ht: '6\'4"',
    pts: "3★", reb: "2★", ast: "4★", stl: "4★", blk: "2★", fg: "3★", ft: "3★", tpm: "2★", to: "3★",
    verdict: "A crafty, pass-first guard with active hands and defensive disruption — the playmaking instincts and steal creation are the dynasty calling cards. The shooting needs significant development before the full multi-category profile unlocks. A high-floor, moderate-ceiling prospect." },
  { rank: 39, pick: "1.39", name: "Braden Smith", school: "PUR", pos: "G", tier: 8, age: 22, ht: '6\'1"',
    pts: "2★", reb: "2★", ast: "5★", stl: "5★", blk: "1★", fg: "2★", ft: "4★", tpm: "5★", to: "3★",
    verdict: "Elite AST, elite STL and elite 3PM — three category pillars from Purdue's floor general. One of the most complete point guard profiles in the class — anchors three columns while shooting efficiently from deep. The scoring and rebounding are limited by size but the playmaking, defensive activity and shooting translate at any level." },
  { rank: 40, pick: "1.40", name: "Darrion Williams", school: "NCSU", pos: "F", tier: 8, age: 22, ht: '6\'6"',
    pts: "4★", reb: "3★", ast: "3★", stl: "3★", blk: "2★", fg: "3★", ft: "4★", tpm: "4★", to: "3★",
    verdict: "A versatile, productive wing whose value comes from contributing across multiple categories without a glaring weakness — scoring, shooting and free-throw efficiency all register. No single elite anchor but the balanced profile plays in every format. A steady, low-variance contributor." },
  { rank: 41, pick: "1.41", name: "Bruce Thornton", school: "OSU", pos: "G", tier: 8, age: 22, ht: '6\'2"',
    pts: "4★", reb: "2★", ast: "4★", stl: "3★", blk: "2★", fg: "3★", ft: "4★", tpm: "3★", to: "4★",
    verdict: "A steady, high-IQ guard with scoring punch and playmaking vision — the type of backcourt piece who keeps the stat sheet balanced across multiple categories. No single elite anchor but the consistency and floor are real. Age and shooting development will determine the dynasty ceiling." },
  { rank: 42, pick: "1.42", name: "Ugonna Onyenso", school: "KEN", pos: "C", tier: 8, age: 22, ht: '7\'0"',
    pts: "2★", reb: "4★", ast: "2★", stl: "3★", blk: "5★", fg: "4★", ft: "2★", tpm: "2★", to: "4★",
    verdict: "Elite BLK — a true rim protector whose shot-blocking rate is among the best in the class. The defensive impact anchors the entire profile. Offensively limited — the scoring and shooting will not carry dynasty value. A specialist whose one elite skill is genuinely impactful in category leagues." },
  { rank: 43, pick: "1.43", name: "Alex Karaban", school: "UCONN", pos: "F", tier: 8, age: 23, ht: '6\'8"',
    pts: "2★", reb: "2★", ast: "3★", stl: "2★", blk: "3★", fg: "3★", ft: "5★", tpm: "5★", to: "3★",
    verdict: "Elite FT% and elite 3PM — two category pillars built on shooting efficiency. A 6'8\" forward who stretches the floor from every spot and converts at the line at an elite rate. The shooting translates immediately. Age 23.2 compresses the dynasty runway — the production is ready-made, the timeline is short." },
  { rank: 44, pick: "1.44", name: "Trevon Brazile", school: "ARK", pos: "F/C", tier: 8, age: 24, ht: '6\'10"',
    pts: "2★", reb: "3★", ast: "2★", stl: "5★", blk: "5★", fg: "4★", ft: "3★", tpm: "2★", to: "3★",
    verdict: "Elite STL and elite BLK — a rare dual-defensive anchor at 6'10\" with near-7'4\" wingspan and a 41\" max vertical. The athletic ceiling is massive and the defensive rebound rate confirms the motor is real. A growing divide exists on whether the ball skills can catch up to the raw physical gifts — the defensive production is not a projection. It's already there." },
  { rank: 45, pick: "1.45", name: "Jack Kayil", school: "INTL", pos: "G", tier: 8, age: 20, ht: '6\'5"',
    pts: "4★", reb: "2★", ast: "5★", stl: "4★", blk: "1★", fg: "1★", ft: "3★", tpm: "2★", to: "3★",
    verdict: "Elite AST — a playmaking guard who led Germany to a FIBA U19 silver medal with 6.6 APG and earned BBL Best Young Player honours at 20 years old against professionals nearly a decade his senior. The passing and ball skills are genuine. FG% and 3PM are the severe category drags — 40% from the field and 34% from deep need significant improvement at NBA level. A development play built on playmaking upside and age." },
  { rank: 46, pick: "1.46", name: "Rafael Castro", school: "INTL", pos: "C", tier: 8, age: 24, ht: '6\'11"',
    pts: "3★", reb: "5★", ast: "2★", stl: "4★", blk: "4★", fg: "5★", ft: "2★", tpm: "1★", to: "3★",
    verdict: "Elite REB and elite FG% — two genuine category anchors. A physical, imposing center who dominates the glass and finishes at an elite rate around the rim. A non-shooter — the 3PM is absent. The dynasty case is built entirely on rebounding and efficiency as a traditional interior big." },
  { rank: 47, pick: "1.47", name: "Sergio De Larrea", school: "INTL", pos: "G", tier: 8, age: 20, ht: '6\'6"',
    pts: "3★", reb: "2★", ast: "5★", stl: "2★", blk: "2★", fg: "3★", ft: "3★", tpm: "3★", to: "1★",
    verdict: "Elite AST — a creative, high-feel playmaker out of Valencia whose passing vision and court sense are the standout traits. The scoring and size are limited. A specialist point guard whose dynasty value lives and dies with assist volume and whether he earns NBA minutes." },
  { rank: 48, pick: "1.48", name: "Duke Miles", school: "INTL", pos: "G", tier: 8, age: 20, ht: '6\'5"',
    pts: "3★", reb: "2★", ast: "4★", stl: "4★", blk: "2★", fg: "3★", ft: "4★", tpm: "3★", to: "3★",
    verdict: "A well-rounded international guard whose passing and defensive activity stand out — the profile contributes across multiple categories without a glaring weakness. No single elite anchor but the balanced production and versatility create a solid multi-category floor." },
  { rank: 49, pick: "1.49", name: "Quadir Copeland", school: "NCSU", pos: "G", tier: 8, age: 23, ht: '6\'6"',
    pts: "3★", reb: "2★", ast: "5★", stl: "5★", blk: "2★", fg: "3★", ft: "3★", tpm: "5★", to: "3★",
    verdict: "Elite AST, elite STL and elite 3PM — three category pillars. Led the ACC in assists at 6.5 per game while shooting 39.7% from three on volume. Set a career high of 16 assists in one game. The passing, defensive activity and shooting combine in a way that makes this profile one of the best values on the entire board at pick 49." },
  { rank: 50, pick: "1.50", name: "Nick Martinelli", school: "NWST", pos: "F", tier: 8, age: 22, ht: '6\'6"',
    pts: "4★", reb: "3★", ast: "2★", stl: "2★", blk: "2★", fg: "3★", ft: "3★", tpm: "2★", to: "4★",
    verdict: "A back-to-back Big Ten scoring champion who shot 42% from three — a left-handed forward with elite footwork, mismatch-hunting ability in the post and genuine physicality. The scoring touch and shooting efficiency are the dynasty calling cards. A major value grab at this range whose offensive skill set is more polished than most forwards ranked above him." },
];

const CATS = ["pts", "reb", "ast", "stl", "blk", "fg", "ft", "tpm", "to"] as const;
const CAT_LABELS: Record<string, string> = {
  pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK", fg: "FG%", ft: "FT%", tpm: "3PM", to: "TO"
};

function starStyle(star: string): { color: string; fontWeight: number } {
  const count = parseInt(star);
  if (count === 5) return { color: "var(--green-elite)",  fontWeight: 700 };
  if (count === 4) return { color: "#15803d",             fontWeight: 400 };
  if (count === 3) return { color: "var(--dynasty-gold)", fontWeight: 400 };
  if (count === 2) return { color: "var(--text-muted)",    fontWeight: 400 };
  return                  { color: "var(--red-severe)",   fontWeight: 700 };
}

function tierInfo(tier: number): { color: string; label: string } {
  if (tier === 1) return { color: "var(--dynasty-gold)",   label: "GENERATIONAL_TIER" };
  if (tier === 2) return { color: "var(--green-elite)",    label: "ALL_STAR_TIER" };
  if (tier === 3) return { color: "var(--blueprint-glow)", label: "STARTER_HIGH_END_TIER" };
  if (tier === 4) return { color: "#9b5de5",               label: "STARTER_LOW_END_TIER" };
  if (tier === 5) return { color: "var(--edge-orange)",    label: "UPSIDE_TIER" };
  if (tier === 6) return { color: "#f72585",               label: "ROTATION_TIER" };
  if (tier === 7) return { color: "#00c8e0",               label: "PRIORITY_2ND_ROUNDER_TIER" };
  return           { color: "#64748b",                     label: "NOT_FANTASY_RELEVANT_TIER" };
}

function toKebabName(name: string): string {
  return name.toLowerCase().replace(/[.,]/g, "").replace(/['\s]+/g, "-").replace(/-+/g, "-");
}

function getInitials(name: string): string {
  const parts = name.split(" ");
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function ProspectHeadshot({ name }: { name: string }) {
  const kebabName = toKebabName(name);
  const initials = getInitials(name);

  const circleStyle: React.CSSProperties = {
    width: 48, height: 48, borderRadius: "50%", flexShrink: 0,
  };

  return (
    <div style={{ position: "relative", ...circleStyle }}>
      <img
        src={`/images/prospects/${kebabName}.jpg`}
        alt={name}
        width={48}
        height={48}
        style={{ ...circleStyle, objectFit: "cover", display: "block" }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
          const fallback = (e.currentTarget as HTMLImageElement).nextElementSibling as HTMLElement;
          if (fallback) fallback.style.display = "flex";
        }}
      />
      <div style={{
        ...circleStyle,
        background: "#2563EB", color: "white",
        display: "none", alignItems: "center", justifyContent: "center",
        fontSize: "13px", fontWeight: 700,
        position: "absolute", top: 0, left: 0,
      }}>{initials}</div>
    </div>
  );
}

function positionBadge(pos: string) {
  if (pos === "G") return <span className="db-pos-badge db-pos-badge-g">G</span>;
  if (pos === "F") return <span className="db-pos-badge db-pos-badge-f">F</span>;
  if (pos === "C") return <span className="db-pos-badge db-pos-badge-c">C</span>;
  if (pos === "G/F") {
    return (
      <span className="db-pos-badge db-pos-badge-split">
        <span className="db-pos-badge-split-l">G</span>
        <span className="db-pos-badge-split-r">F</span>
      </span>
    );
  }
  if (pos === "F/C") {
    return (
      <span className="db-pos-badge db-pos-badge-split">
        <span className="db-pos-badge-split-l db-pos-badge-split-l-orange">F</span>
        <span className="db-pos-badge-split-r db-pos-badge-split-r-gold">C</span>
      </span>
    );
  }
  return <span className="db-pos-badge db-pos-badge-g">{pos}</span>;
}

export default function DraftBoard() {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);

  const toggle = (rank: number) => {
    setExpanded(expanded === rank ? null : rank);
  };

  return (
    <div className="draft-board-shell">
      <SiteNav
        active="draft"
        joinFree={
          <a
            href="#"
            className="nav-cta"
            onClick={(e) => {
              e.preventDefault();
              setShowModal(true);
            }}
          >
            Join Free
          </a>
        }
      />

<div className="db-board-wrap" style={{ padding: "80px 60px 100px", maxWidth: "900px", width: "100%", margin: "0 auto" }}>
        {DRAFT_BOARD.map((p, i) => {
          const isExpanded = expanded === p.rank;
          const { color: tierColor, label: tierLabel } = tierInfo(p.tier);
          const hasCard = !!(p as unknown as Record<string, string>).verdict;
          const prev = i > 0 ? DRAFT_BOARD[i - 1] : null;
          const showDivider = i === 0 || (!!prev && p.tier !== prev.tier);

          return (
            <Fragment key={p.rank}>
              {showDivider && (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  margin: p.tier === 1 ? "0 0 8px" : "28px 0 8px",
                }}>
                  <div style={{ flex: 1, height: "1px", background: `${tierColor}40` }} />
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: "2px",
                    color: tierColor,
                    whiteSpace: "nowrap",
                  }}>// {tierLabel}</span>
                </div>
              )}
            <div style={{ position: "relative" }}>
              <div
                onClick={() => (hasCard ? toggle(p.rank) : undefined)}
                className={`db-row ${isExpanded ? "db-row-expanded" : "db-row-collapsed"}`}
                style={{
                  background: isExpanded ? "var(--bg-card-hover)" : "var(--bg-card)",
                  cursor: hasCard ? "pointer" : "default",
                }}
              >
                <div style={{
                  fontFamily: "'Oswald', sans-serif", fontWeight: 700,
                  fontSize: "28px", color: tierColor,
                  minWidth: "44px", textAlign: "center"
                }}>{p.rank}</div>
                <ProspectHeadshot name={p.name} />
                <div className="db-player-main">
                  <div className="db-player-name">{p.name}</div>
                  <div className="db-player-meta">
                    {positionBadge(p.pos)}
                    <span className="dbp-school">{p.school}</span>
                    {p.ht && <span className="db-player-meta-text db-player-meta-height">· {p.ht}</span>}
                  </div>
                </div>
                {hasCard && (
                  <div className="db-expand-arrow" style={{
                    transform: isExpanded ? "rotate(180deg)" : "rotate(0)"
                  }}>▼</div>
                )}
              </div>

              {isExpanded && hasCard && (
                <div className="db-expanded-panel" style={{ animation: "fadeUp 0.3s ease-out" }}>
                  <div style={{
                    fontFamily: "'Oswald', sans-serif", fontSize: "11px",
                    letterSpacing: "3px", textTransform: "uppercase",
                    color: "var(--edge-orange)", marginBottom: "16px"
                  }}>Category Ratings</div>
                  <div style={{
                    display: "grid", gridTemplateColumns: "repeat(9, 1fr)",
                    gap: "8px", marginBottom: "24px"
                  }}>
                    {CATS.map((cat) => {
                      const val = (p as unknown as Record<string, string>)[cat];
                      if (!val) return null;
                      return (
                        <div key={cat} style={{ textAlign: "center" }}>
                          <div style={{
                            fontFamily: "'Oswald', sans-serif", fontSize: "12px",
                            fontWeight: 600, letterSpacing: "1px",
                            color: "var(--text-muted)", marginBottom: "6px"
                          }}>{CAT_LABELS[cat]}</div>
                          <div style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: "13px",
                            ...starStyle(val),
                          }}>{val}</div>
                          <div style={{
                            height: "3px", borderRadius: "2px",
                            background: starStyle(val).color,
                            marginTop: "6px", opacity: 0.6
                          }}></div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{
                    fontFamily: "'Oswald', sans-serif", fontSize: "11px",
                    letterSpacing: "3px", textTransform: "uppercase",
                    color: "var(--edge-orange)", marginBottom: "10px"
                  }}>Dynasty Verdict</div>
                  <p style={{
                    fontSize: "14px", color: "var(--text-secondary)",
                    lineHeight: 1.65
                  }}>{(p as unknown as Record<string, string>).verdict}</p>
                </div>
              )}
            </div>
            </Fragment>
          );
        })}

      </div>

      <footer>
        <div className="footer-brand">Fantasy Hoops <span className="accent">Edge</span></div>
        <div className="footer-links">
          <a href="/">Home</a>
          <a href="/draft-board">Draft Board</a>
          <a href="#">Prospect Lab</a>
          <a href="#">Predictions</a>
        </div>
        <div className="footer-social">
          <a href="#" title="X / Twitter">𝕏</a>
        </div>
      </footer>

      <div
        className={`modal-overlay ${showModal ? "active" : ""}`}
        onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
      >
        <div className="modal-box">
          <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
          <div className="modal-title">Get The Edge</div>
          <p className="modal-sub">Free dynasty rankings, rookie boards, and AI-powered advice.</p>
          <button className="modal-google">
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Sign up with Google
          </button>
          <div className="modal-divider">
            <div className="modal-divider-line"></div>
            <span>or</span>
            <div className="modal-divider-line"></div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <input type="email" placeholder="Email address" className="modal-input" />
            <input type="password" placeholder="Create password" className="modal-input" />
            <button className="modal-submit">Sign Up Free</button>
          </div>
          <p className="modal-footer">
            Already have an account? <a href="#">Log in</a>
          </p>
        </div>
      </div>
    </div>
  );
}
