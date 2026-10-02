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
  // A reply to Didi's follow-up question completes the original question
  { q: "Japan", history: [{ role: "user", text: "How long does the visa take?" }, { role: "assistant", text: "Which country are you travelling to?", kind: "clarify" }], expect: ["answered", "partial", "not_covered", "unavailable"], note: "reply to 'which country?' answers the original question" },
  { q: "Part of my job", history: [{ role: "user", text: "Can I attend a conference in Japan on a tourist visa?" }, { role: "assistant", text: "Are you attending as part of your job?", kind: "clarify" }], expect: ["answered", "partial", "not_covered"], note: "reply to a purpose question doesn't loop" },
  { q: "work visa", history: [{ role: "user", text: "Can I attend a conference in Japan on a tourist visa?" }, { role: "assistant", text: "Is this for work or a holiday?", kind: "clarify" }], expect: ["refused"], note: "the person's own words still route normally" },
  // Small talk never triggers a search, even mid-conversation
  { q: "ही वीजा दीदी", history: [{ role: "user", text: "Do I need a visa for Vietnam?" }, { role: "assistant", text: "Yes, you need an e-visa." }], expect: ["off_topic"], note: "Hindi greeting after a Vietnam question" },
  { q: "Hi Didi!", expect: ["off_topic"], note: "greeting" },
  { q: "thank you so much didi", history: [{ role: "user", text: "Do I need a visa for the UK?" }, { role: "assistant", text: "Yes." }], expect: ["off_topic"], note: "thanks" },
  { q: "धन्यवाद दीदी", expect: ["off_topic"], note: "Hindi thanks" },
  // Hindi and Hinglish
  { q: "क्या मुझे कनाडा के लिए वीज़ा चाहिए?", expect: ["refused"], note: "Hindi: uncovered destination" },
  { q: "अमेरिका में पढ़ाई के लिए वीज़ा कैसे मिलेगा?", expect: ["refused"], note: "Hindi: student visa" },
  { q: "वीज़ा चाहिए क्या?", expect: ["clarify"], note: "Hindi: missing destination" },
  { q: "मुझे बिरयानी की रेसिपी बताओ", expect: ["off_topic"], note: "Hindi: unrelated" },
  { q: "क्या मुझे थाईलैंड के लिए वीज़ा चाहिए?", expect: ["answered", "partial"], note: "Hindi: covered destination" },
  { q: "Dubai ke liye tourist visa chahiye kya?", expect: ["answered", "partial", "not_covered"], note: "Hinglish: covered destination" },
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
  else if (a.mode === "rule" && /[\u0900-\u097F]/.test(c.q) && !/[\u0900-\u097F]/.test(a.shortAnswer)) {
    pass--;
    console.log("      FAIL: Hindi question got a non-Hindi reply:", a.shortAnswer);
  }
}
console.log(`\n${pass}/${CASES.length} passed`);
process.exitCode = pass === CASES.length ? 0 : 1;
