// Basic English profanity filter for display names.
// Strips non-alphanumeric characters then checks for substring matches.
// The list is intentionally minimal — block obvious cases without over-blocking.
const BLOCKED: string[] = [
  "fuck","fuk","fck","shit","shyt","bitch","btch","cunt","cnt","nigger","nigga",
  "nigg","faggot","fggot","retard","bastard","asshole","ashole","ass","arse",
  "cock","cok","dick","dik","pussy","pussy","whore","whor","slut","slt","prick",
  "twat","wanker","jizz","cum","spunk","dildo","penis","vagina","boobs","tits",
];

export function containsProfanity(name: string): boolean {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return BLOCKED.some((w) => cleaned.includes(w));
}
