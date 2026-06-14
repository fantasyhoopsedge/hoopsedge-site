/**
 * §6 grader dry-run. Hand-computed expected scores, asserted for equality.
 * This is the non-cuttable safeguard: a mis-scored launch night poisons trust.
 *
 * Run: npx tsc --module commonjs --target es2019 --outDir .tmp \
 *        src/lib/draftNight/grader.ts src/lib/draftNight/config.ts \
 *        scripts/draft-night-grader-dryrun.ts
 *      node .tmp/scripts/draft-night-grader-dryrun.js
 */
import {
  gradeMockLottery,
  gradeGuardOrder,
  gradeDraftedHigher,
  gradeFirstRound,
  combinedScore,
  type ResultsPicks,
} from "../src/lib/draftNight/grader";
import {
  guardOrderConfig,
  draftedHigherConfig,
  firstRoundConfig,
  mockLotteryConfig,
} from "../src/lib/draftNight/config";

let failures = 0;
function expect(label: string, got: number, want: number) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${got}, want ${want}`);
}

const lottery = mockLotteryConfig([]); // pool unused by the grader scoring path

// ── A. mock_lottery: perfect 14/14 (ceiling 560) ────────────────────────────
{
  const order = [
    "cameron-boozer", "darryn-peterson", "aj-dybantsa", "caleb-wilson",
    "kingston-flemings", "keaton-wagler", "aday-mara", "mikel-brown-jr",
    "ebuka-okorie", "labaron-philon", "hannes-steinbach", "dailyn-swain",
    "darius-acuff-jr", "yaxel-lendeborg",
  ];
  const picks: ResultsPicks = {};
  order.forEach((slug, i) => (picks[slug] = i + 1)); // each at its exact slot
  expect("mock_lottery perfect", gradeMockLottery(order, lottery, picks), 560);
}

// ── B. mock_lottery: all 14 undrafted -> 0 ──────────────────────────────────
{
  const order = [
    "nick-martinelli", "quadir-copeland", "duke-miles", "sergio-de-larrea",
    "jack-kayil", "rafael-castro", "alex-karaban", "trevon-brazile",
    "ugonna-onyenso", "darrion-williams", "baba-miller", "jaden-bradley",
    "braden-smith", "dillon-mitchell",
  ];
  expect("mock_lottery all undrafted", gradeMockLottery(order, lottery, {}), 0);
}

// ── C. mock_lottery: a prospect who "went #19" scores 0 at any slot ──────────
{
  const order = ["cameron-boozer", "christian-anderson", "darryn-peterson"];
  // boozer #1@slot1 -> 40; anderson #19@slot2 -> d17, 19>14 -> 0; peterson #2@slot3 -> d1 -> 20
  const picks: ResultsPicks = {
    "cameron-boozer": 1,
    "christian-anderson": 19,
    "darryn-peterson": 2,
  };
  expect("mock_lottery #19 = 0", gradeMockLottery(order, lottery, picks), 60);
}

// ── D. mock_lottery: inclusion credit (+5) and off-by-2 (+10) ────────────────
{
  const order = ["caleb-wilson", "aj-dybantsa", "cameron-boozer"];
  // wilson #4@slot1 d3,a<=14 -> +5; dybantsa #3@slot2 d1 -> 20; boozer #1@slot3 d2 -> 10
  const picks: ResultsPicks = {
    "caleb-wilson": 4,
    "aj-dybantsa": 3,
    "cameron-boozer": 1,
  };
  expect("mock_lottery inclusion+near", gradeMockLottery(order, lottery, picks), 35);
}

// ── E. guard_order: perfect order (ceiling 150) ─────────────────────────────
{
  const picks: ResultsPicks = {
    "darryn-peterson": 2, "kingston-flemings": 5, "keaton-wagler": 6,
    "mikel-brown-jr": 8, "darius-acuff-jr": 13,
  };
  // actual order: peterson, flemings, wagler, mikel-brown-jr, acuff
  const payload = [
    "darryn-peterson", "kingston-flemings", "keaton-wagler",
    "mikel-brown-jr", "darius-acuff-jr",
  ];
  expect("guard_order perfect", gradeGuardOrder(payload, guardOrderConfig, picks), 150);
}

// ── F. guard_order: two adjacent swaps, no bonus ────────────────────────────
{
  const picks: ResultsPicks = {
    "darryn-peterson": 2, "kingston-flemings": 5, "keaton-wagler": 6,
    "mikel-brown-jr": 8, "darius-acuff-jr": 13,
  };
  // user keeps default pool order: acuff at pos3, mikel at pos4 (both off by 1)
  const payload = [
    "darryn-peterson", "kingston-flemings", "keaton-wagler",
    "darius-acuff-jr", "mikel-brown-jr",
  ];
  // 20+20+20+10+10 = 80, no exact bonus
  expect("guard_order partial", gradeGuardOrder(payload, guardOrderConfig, picks), 80);
}

// ── G. drafted_higher: mix incl. a both-undrafted push ──────────────────────
{
  const picks: ResultsPicks = {
    "dailyn-swain": 12, "allen-graves": 15,
    "kingston-flemings": 5, "darius-acuff-jr": 13,
    "ebuka-okorie": 9, "brayden-burries": 17,
    "morez-johnson-jr": 21, "hannes-steinbach": 11,
    // lendeborg & philon absent -> pair 5 is a push
  };
  const payload = [
    "dailyn-swain",      // swain<graves -> correct +30
    "darius-acuff-jr",   // flemings<acuff, picked acuff -> 0
    "ebuka-okorie",      // okorie<burries -> correct +30
    "hannes-steinbach",  // steinbach<johnson -> correct +30
    "yaxel-lendeborg",   // both undrafted -> push 0
  ];
  expect("drafted_higher mix+push", gradeDraftedHigher(payload, draftedHigherConfig, picks), 90);
}

// ── H. first_round: all four quadrants ──────────────────────────────────────
{
  const picks: ResultsPicks = {
    "richie-saunders": 27, // R1
    "bruce-thornton": 30,  // R1 (boundary <=30)
    "ryan-conwell": 33,    // not R1
    // joshua-jefferson absent -> not R1
  };
  const tagged = ["richie-saunders", "ryan-conwell"];
  // saunders tag+R1 +40; conwell tag+!R1 -30; thornton !tag+R1 0; jefferson !tag+!R1 +20
  expect("first_round 4 quadrants", gradeFirstRound(tagged, firstRoundConfig, picks), 30);
}

// ── I. first_round worst case + combined floor-at-0 ─────────────────────────
{
  const picks: ResultsPicks = {
    "richie-saunders": 27, "bruce-thornton": 30, "ryan-conwell": 33,
  };
  const tagged = ["ryan-conwell", "joshua-jefferson"]; // both !R1 tagged -> -30 each
  const fr = gradeFirstRound(tagged, firstRoundConfig, picks);
  expect("first_round worst", fr, -60);
  expect("combined floors negative to 0", combinedScore([fr, 0]), 0);
  expect("combined sums positives", combinedScore([560, 150, 90, 30]), 830);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
