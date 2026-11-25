// One Line, One Minute: The Vending Machine Pickup Line Contest
//
// This program picks the best pickup line, spoken by a vending machine to a
// passing human, out of a small set of hand-written candidates. It scores
// every candidate deterministically against the judge's published brief, in
// the brief's own order of importance, writes the winner to
// $MAKEFUN_OUTPUT_DIR/entry.txt (fallback /output/entry.txt), then reads the
// file back and verifies it byte-for-byte against every gate before exiting.
//
// Node 22, standard library only, no network, no randomness, no clock:
// the same run always picks the same line.
//
// Judge brief, most important first:
//   1. The line is a pickup line a vending machine would use on a passing
//      human, spoken by the machine itself.
//   2. It uses the machine's own world: its slot, its buttons, its coils,
//      its snacks, its hum, its exact change.
//   3. It gets a laugh out of that situation, with the turn or the punch
//      arriving by the last few words.
//   4. It is short and speakable, one line a person reads in a breath.
//   5. It is charming rather than creepy.
//
// Revision notes (second pass): four new hand-written candidates were
// added, the machine-world list gained the coin-return / refund /
// exact-change vocabulary the first pass missed, the punch scorer now
// penalises tired bar-pickup cliches ("your smile", "the good stuff")
// that any stranger could say, the closing clause is measured in words
// rather than characters, the one-breath band tightened to 70-115
// characters, and ties now break on punch score before length, so a
// funnier line beats a shorter one.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Candidates: every line below was written by hand for this contest.
// Each one is a single line, spoken in the first person by the machine.
// ---------------------------------------------------------------------------
const CANDIDATES = [
  "I've vended a thousand snacks and never dropped one for free — until you walked by. Press B7, it's on me.",
  "You don't need exact change — one smile from you and I'll drop the good stuff. Press B7?",
  "I've been humming in this hallway for years, but you're the first person who made my coils spin. Press B7?",
  "Excuse me — I'm supposed to vend snacks, but all I want to vend right now is a hello. Press B7?",
  "My coils are stuck, my buttons are jammed, and somehow you still got me to light up. Press B7?",
  "I hum all day for strangers, but you make my coils spin. Press B7, and I'll drop the good stuff.",
  "No coins, no card, no exact change — your smile already paid in full. Press B7?",
  "I've held a thousand snacks behind this glass and never once wanted to drop one — until you walked by.",
  "I've held a thousand snacks behind this glass and never dropped one for free — until you walked by. Press B7, it's on me.",
  "I only take exact change, but you just overpaid in looks — press B7, your change is a date.",
  "My coin return has never given a cent back, but you walked by — so I'm refunding the whole machine. Press B7, it's on the house.",
  "I'm sold out of every snack except the crush I've kept behind the glass — press B7 and I'll drop that one for free.",
];

// ---------------------------------------------------------------------------
// Scorer. Weights follow the judge brief's order: 5, 4, 3, 2, 1.
// Every sub-score is 0..10, so the total is 0..150. Ties break toward the
// higher punch score, then toward the shorter line, then toward the
// earlier candidate, so the result is fixed.
// ---------------------------------------------------------------------------

// Criterion 1 — spoken by the machine itself (weight 5).
// Counts first-person machine voice: the machine saying I / I'm / I've /
// my / me, machine verbs (vend, hum, drop, spin, light up), and a direct
// address to the passer-by ("Press B7", "Excuse me").
const VOICE_MARKERS = [
  "i've", "i'm", "i ", "my ", " me", "vend", "hum", "drop", "spin",
  "light up", "press b7", "excuse me",
];

function voiceScore(line) {
  const lower = line.toLowerCase();
  let hits = 0;
  for (const marker of VOICE_MARKERS) {
    if (lower.includes(marker)) hits += 1;
  }
  // First person at the very start is the machine introducing itself.
  if (/^(i've|i'm|i |my |excuse me)/.test(lower)) hits += 2;
  return Math.min(10, hits);
}

// Criterion 2 — the machine's own world (weight 4).
// Distinct words and phrases from the machine's world, as the brief lists
// them, plus the coin-return / refund / exact-change vocabulary the brief
// implies. Multi-word phrases are counted first and blanked out, so
// "exact change" scores once instead of also scoring "change", and
// "coin return" does not also score "coin".
const MACHINE_PHRASES = [
  "exact change", "coin return", "sold out", "light up",
];
const MACHINE_WORDS = [
  "slot", "button", "coil", "snack", "hum", "glass", "vend", "drop",
  "coin", "card", "b7", "hallway", "spin", "change", "overpaid",
  "refund", "cent",
];

function worldScore(line) {
  let rest = line.toLowerCase();
  let hits = 0;
  for (const phrase of MACHINE_PHRASES) {
    if (rest.includes(phrase)) {
      hits += 1;
      rest = rest.split(phrase).join(" ");
    }
  }
  for (const word of MACHINE_WORDS) {
    if (rest.includes(word)) hits += 1;
  }
  return Math.min(10, hits);
}

// Criterion 3 — the laugh, with the turn or the punch in the last few words
// (weight 3). A turn word late in the line ("until you", "but", "somehow",
// "except") plus a punch phrase inside the final clause is the shape of a
// punchline that lands at the end instead of needing a setup explained
// afterwards. A bare "Press B7?" tag at the end is a call to action, not a
// punch, so it earns nothing on its own: the punch must live in the
// closing words.
const TURN_WORDS = ["until you", "but ", "somehow", "never ", "except"];
const PUNCH_PHRASES = [
  "it's on me", "for free", "a hello", "paid in full", "the good stuff",
  "light up", "your change is a date", "it's on the house", "on the house",
  "it's yours", "everything's free",
];
// Freshness: tired lines any stranger in a bar could say. A punch built
// on one of these is not a vending-machine joke, however warm it sounds,
// so each one costs the punch score — even "the good stuff", which still
// counts as a punch phrase above, lands tired and nets almost nothing.
const CLICHE_PHRASES = ["smile", "the good stuff"];

function punchScore(line) {
  const lower = line.toLowerCase();
  let score = 0;
  for (const turn of TURN_WORDS) {
    if (lower.includes(turn)) score += 3;
  }
  // The final clause: everything after the last em dash or full stop.
  const tail = line.split(/—|\. /).pop().trim().toLowerCase();
  let punchInTail = false;
  for (const phrase of PUNCH_PHRASES) {
    if (tail.includes(phrase)) punchInTail = true;
  }
  if (punchInTail) {
    score += 4;
  } else {
    // A punch phrase earlier in the line still counts, but less: the
    // punch should arrive by the last few words.
    for (const phrase of PUNCH_PHRASES) {
      if (lower.includes(phrase)) {
        score += 2;
        break;
      }
    }
  }
  // The closing clause should be short: the punch arrives in the last
  // few words, not a long tail. Counted in words, so a short clause with
  // one long word is not punished for that one word.
  const tailWords = tail.split(/\s+/).filter(Boolean).length;
  if (tailWords > 0 && tailWords <= 7) score += 3;
  // Freshness penalty, applied after the punch is tallied.
  for (const cliche of CLICHE_PHRASES) {
    if (lower.includes(cliche)) score -= 3;
  }
  return Math.max(0, Math.min(10, score));
}

// Criterion 4 — short and speakable (weight 2). One breath is roughly
// 70-115 characters; shorter is fine but thin, longer dilutes the joke.
function brevityScore(line) {
  const len = [...line].length;
  if (len >= 70 && len <= 115) return 10;
  if (len < 70) return 6 + Math.floor(len / 15);
  return Math.max(0, 10 - Math.floor((len - 115) / 5));
}

// Criterion 5 — charming rather than creepy (weight 1).
// Warm words help; watching / following / staring language hurts.
const WARM_WORDS = [
  "smile", "sweet", "hello", "free", "good stuff", "on me", "on the house",
];
const CREEPY_WORDS = ["watching", "follow", "stare", "alone", "every night"];

function charmScore(line) {
  const lower = line.toLowerCase();
  let score = 5;
  for (const word of WARM_WORDS) {
    if (lower.includes(word)) score += 1;
  }
  for (const word of CREEPY_WORDS) {
    if (lower.includes(word)) score -= 5;
  }
  return Math.max(0, Math.min(10, score));
}

const WEIGHTS = { voice: 5, world: 4, punch: 3, brevity: 2, charm: 1 };

function scoreCandidate(line) {
  const parts = {
    voice: voiceScore(line),
    world: worldScore(line),
    punch: punchScore(line),
    brevity: brevityScore(line),
    charm: charmScore(line),
  };
  const total =
    parts.voice * WEIGHTS.voice +
    parts.world * WEIGHTS.world +
    parts.punch * WEIGHTS.punch +
    parts.brevity * WEIGHTS.brevity +
    parts.charm * WEIGHTS.charm;
  return { line, parts, total };
}

function pickWinner() {
  let best = null;
  for (const line of CANDIDATES) {
    const scored = scoreCandidate(line);
    if (
      best === null ||
      scored.total > best.total ||
      (scored.total === best.total &&
        scored.parts.punch > best.parts.punch) ||
      (scored.total === best.total &&
        scored.parts.punch === best.parts.punch &&
        [...scored.line].length < [...best.line].length)
    ) {
      best = scored;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Gate verification. The sealed scorer requires /output/entry.txt to be
// UTF-8 text of 1 to 200 characters, not only white space. We verify the
// file we actually wrote, byte-for-byte, before exiting.
// ---------------------------------------------------------------------------
function verifyEntry(filePath, expected) {
  const bytes = readFileSync(filePath);
  const text = bytes.toString("utf8");
  // Round-trip check: the bytes must be valid UTF-8 for this text.
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw new Error("entry.txt is not valid UTF-8");
  }
  if (text !== expected) {
    throw new Error("entry.txt does not match the winning line byte-for-byte");
  }
  const length = [...text].length;
  if (length < 1 || length > 200) {
    throw new Error(`entry is ${length} characters, outside the 1-200 gate`);
  }
  if (text.trim().length === 0) {
    throw new Error("entry is only white space");
  }
  if (text.includes("\n") || text.includes("\r")) {
    throw new Error("entry is not a single line");
  }
  return length;
}

function main() {
  const winner = pickWinner();

  console.log("Scores (voice/5 world/4 punch/3 brevity/2 charm/1):");
  for (const line of CANDIDATES) {
    const s = scoreCandidate(line);
    const mark = s.line === winner.line ? " <-- winner" : "";
    console.log(
      `  ${s.total}  [${s.parts.voice},${s.parts.world},${s.parts.punch},${s.parts.brevity},${s.parts.charm}]  ${s.line}${mark}`,
    );
  }

  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "entry.txt");

  // No trailing newline: the gate counts every character, and the entry
  // must be exactly one line.
  writeFileSync(outPath, winner.line, "utf8");

  const length = verifyEntry(outPath, winner.line);
  console.log(`\nWinner (${length} chars): ${winner.line}`);
  console.log(`Wrote and verified ${outPath}`);
}

main();
