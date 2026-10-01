// Deterministic guardrails that run before any model call. These are the cases the PRD
// says must be handled the same way every time (100% honest-refusal target).
import { DESTINATIONS, UNCOVERED_DESTINATIONS, type Destination } from "./destinations";

export type Route =
  | { kind: "answer"; destinations: Destination[]; judgment: boolean }
  | { kind: "ask_destination" }
  | { kind: "uncovered_destination"; name: string }
  | { kind: "out_of_scope_visa"; what: string }
  | { kind: "other_passport"; nationality: string }
  | { kind: "off_topic" };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (w: string) => new RegExp(`(^|[^a-z])${escape(w)}($|[^a-z])`, "i");

export function findDestinations(text: string): Destination[] {
  const found: Destination[] = [];
  for (const d of DESTINATIONS) {
    const hit = d.aliases.some((a) => {
      // "us" is also a pronoun: only count it written as "US" / "U.S."
      if (a === "us" || a === "u.s") return /(^|[^A-Za-z])U\.?S\.?($|[^A-Za-z])/.test(text);
      return wordRe(a).test(text);
    });
    if (hit) found.push(d);
  }
  return found;
}

function findUncovered(text: string) {
  return UNCOVERED_DESTINATIONS.find((c) => wordRe(c).test(text));
}

const OUT_OF_SCOPE: [RegExp, string][] = [
  [/\b(student|study|studying|studies|university|college|admission|masters|phd|f-?1 visa)\b/i, "student visas"],
  [/\b(work visa|work permit|employment visa|job offer|working holiday|skilled worker|h-?1b|get a job|working there)\b/i, "work visas"],
  [/\b(residen(ce|cy)|permanent resident|pr visa|green card|settle|immigrate|citizenship|golden visa|spouse visa|dependent visa|family visa)\b/i, "residency or long-term visas"],
];

const OTHER_PASSPORT = /\b(american|british|canadian|australian|nepali|nepalese|bangladeshi|pakistani|sri lankan|german|french|chinese|oci)\s+(passport|citizen|national|card)/i;
const NON_INDIAN_PASSPORT_HOLDER = /\bi (hold|have) (an? )?(?!indian\b)([a-z]+) passport\b/i;

const JUDGMENT = /\b(will (i|my|we|he|she|they|mom|mum|dad|parents?|mother|father)\b.*\b(get|be)\b.*\b(approved|rejected|refused|accepted|granted|denied))|\b(chances?|likely|likelihood|probability|guarantee)\b.*\b(approv|reject|refus|get(ting)? (the |a |my )?visa)/i;

const TRAVEL_WORDS = /\b(visa|visas|evisa|e-visa|eta|entry|enter|passport|travel|trip|visit|visiting|tourist|tourism|holiday|vacation|business|conference|meeting|documents?|fees?|cost|process(ing)?|arrival|stay|days|immigration|border|apply|application|onward|return ticket|insurance|transit|go to|going to|fly|flying)\b/i;

export function route(question: string, history: string[] = []): Route {
  const q = question.trim();

  const dests = findDestinations(q);
  const uncovered = findUncovered(q);

  for (const [re, what] of OUT_OF_SCOPE) if (re.test(q)) return { kind: "out_of_scope_visa", what };

  const other = q.match(OTHER_PASSPORT) ?? q.match(NON_INDIAN_PASSPORT_HOLDER);
  if (other) return { kind: "other_passport", nationality: other[1] && other[1] !== "hold" && other[1] !== "have" ? other[1] : other[3] };

  if (!dests.length && uncovered) return { kind: "uncovered_destination", name: uncovered };

  const judgment = JUDGMENT.test(q);

  if (dests.length) return { kind: "answer", destinations: dests.slice(0, 2), judgment };

  // Follow-ups like "what about fees?" inherit the destination from earlier turns.
  for (let i = history.length - 1; i >= 0; i--) {
    const prev = findDestinations(history[i]);
    if (prev.length) {
      if (!TRAVEL_WORDS.test(q) && !judgment && q.split(/\s+/).length > 6) return { kind: "off_topic" };
      return { kind: "answer", destinations: prev.slice(0, 2), judgment };
    }
  }

  if (TRAVEL_WORDS.test(q) || judgment) return { kind: "ask_destination" };
  return { kind: "off_topic" };
}
