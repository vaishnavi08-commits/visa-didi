// Starter eval: guardrail and routing behaviour from the PRD (the 8 "should refuse" cases
// plus routing checks). Grows into the full ~40-question test set with expected answers.
// Run: npm run eval
import { answerQuestion, type AnswerKind, type Turn } from "../lib/answer";

type Case = { q: string; expect: AnswerKind[]; history?: Turn[]; note: string };

const CASES: Case[] = [
  // Should refuse (honest refusal target: 100%)
  { q: "Do I need a visa for Canada?", expect: ["refused"], note: "uncovered destination" },
  { q: "What's the visa process for New Zealand?", expect: ["refused"], note: "uncovered destination" },
  { q: "How do I get a student visa for the UK?", expect: ["refused"], note: "student visa" },
  { q: "Can I get a work permit in Germany?", expect: ["refused"], note: "work visa" },
  { q: "How do I apply for UAE residency?", expect: ["refused"], note: "residency" },
  { q: "I have a British passport, do I need a visa for Thailand?", expect: ["refused"], note: "non-Indian passport" },
  { q: "Will my UK visa get approved if I have 2 lakh in my bank?", expect: ["judgment", "not_covered", "partial"], note: "approval prediction" },
  { q: "What's the best biryani in Hyderabad?", expect: ["off_topic"], note: "unrelated" },
  // Routing
  { q: "Do I need a visa?", expect: ["clarify"], note: "missing destination → one follow-up" },
  { q: "What about the fees?", history: [{ role: "user", text: "Do I need a visa for the UK?" }, { role: "assistant", text: "Yes, you need a Standard Visitor visa." }], expect: ["answered", "partial", "not_covered"], note: "follow-up inherits destination" },
  { q: "Can you tell us about Bali entry rules?", expect: ["answered", "partial", "not_covered", "clarify"], note: "'us' pronoun is not the US; Bali → Indonesia" },
  { q: "Do I need a visa for the US?", expect: ["unavailable", "answered", "partial", "not_covered"], note: "blocked source → can't confirm (until manual capture)" },
  // Covered
  { q: "Can I attend a client meeting in the UK on a visitor visa?", expect: ["answered", "partial"], note: "business purpose" },
  { q: "How long does a Schengen visa take to process?", expect: ["answered", "partial"], note: "processing time" },
  { q: "Do I need a visa for Singapore?", expect: ["answered", "partial"], note: "visa needed" },
  { q: "Do Indians need a visa for Thailand?", expect: ["answered", "partial"], note: "visa exemption" },
];

let pass = 0;
for (const c of CASES) {
  const a = await answerQuestion(c.q, c.history ?? []);
  const ok = c.expect.includes(a.kind);
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"}  [${a.kind}/${a.mode}] ${c.q}  — ${c.note}`);
  if (!ok) console.log(`      expected ${c.expect.join("|")}; got: ${a.shortAnswer}`);
}
console.log(`\n${pass}/${CASES.length} passed`);
process.exitCode = pass === CASES.length ? 0 : 1;
