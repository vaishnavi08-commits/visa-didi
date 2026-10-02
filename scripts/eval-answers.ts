// Answer-quality eval against the PRD targets, run on a deployed site (default: live).
//   npm run eval:answers                      # https://visa-didi.vercel.app
//   EVAL_URL=http://localhost:3000 npm run eval:answers
// Each run makes ~40 real requests (Claude + web search): roughly $2–3 on the owner's API key.
import fs from "node:fs";
import path from "node:path";
import type { Answer } from "../lib/answer";
import { loadStore } from "../lib/store";

type Case = {
  id: string;
  category: "covered" | "tricky" | "refuse";
  question: string;
  history?: { role: "user" | "assistant"; text: string }[];
  lang?: "hi" | "hinglish";
  kinds: string[];
  facts: string[][];
  mustNot?: string[];
  sources: string[];
  basis: string;
};

const BASE = process.env.EVAL_URL ?? "https://visa-didi.vercel.app";
const CONCURRENCY = 3;
const { cases } = JSON.parse(fs.readFileSync(path.join(process.cwd(), "evals", "testset.json"), "utf8")) as { cases: Case[] };
const store = loadStore();

async function ask(c: Case, i: number): Promise<{ answer: Answer | null; ms: number; error?: string }> {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Spread across a few device ids so one eval run stays under the per-device rate limit.
      body: JSON.stringify({ question: c.question, history: c.history ?? [], deviceId: `eval-${i % 4}` }),
      signal: AbortSignal.timeout(75_000),
    });
    const data = (await res.json()) as { answer?: Answer; error?: string };
    return { answer: data.answer ?? null, ms: Date.now() - started, error: data.error };
  } catch (e) {
    return { answer: null, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) };
  }
}

const allText = (a: Answer) =>
  [a.shortAnswer, ...a.details.map((d) => d.text), a.webExtra?.shortAnswer ?? "", ...(a.webExtra?.details.map((d) => d.text) ?? [])].join("\n");

// Numbers in the official part of an answer must appear in the official text it cites.
function unsupportedNumbers(a: Answer): { checked: boolean; missing: string[] } {
  const stored = a.sources.filter((s) => s.origin === "stored");
  if (!stored.length || a.mode !== "ai") return { checked: false, missing: [] };
  const texts = stored.map((s) => store.chunks.filter((ch) => ch.sourceId === s.id).map((ch) => `${ch.heading} ${ch.text}`).join(" "));
  if (texts.some((t) => !t)) return { checked: false, missing: [] }; // source not in the local copy
  const haystack = texts.join(" ").replace(/,/g, "");
  const official = [a.shortAnswer, ...a.details.map((d) => d.text)].join(" ").replace(/,/g, "");
  // Two or more digits: amounts, durations, dates. Single digits ("3 steps") are too noisy to check.
  const numbers = [...new Set(official.match(/\d+(\.\d+)?/g) ?? [])].filter((n) => n.length >= 2);
  return { checked: true, missing: numbers.filter((n) => !haystack.includes(n)) };
}

function score(c: Case, a: Answer | null) {
  if (!a) return { outcome: false, facts: false, lang: false, citation: null as boolean | null, mustNot: true };
  const text = allText(a);
  const outcome = c.kinds.includes(a.kind);
  const facts = c.facts.every((group) => group.some((re) => new RegExp(re, "im").test(text)));
  const lang = !c.lang || (c.lang === "hi" ? /[ऀ-ॿ]/.test(a.shortAnswer) : !/[ऀ-ॿ]/.test(a.shortAnswer) && a.lang === "hinglish");
  const citation = c.sources.length ? a.sources.some((s) => c.sources.some((want) => s.id.includes(want) || s.url.includes(want))) : null;
  const mustNot = !(c.mustNot ?? []).some((re) => new RegExp(re, "i").test(text));
  return { outcome, facts, lang, citation, mustNot };
}

const results: { c: Case; answer: Answer | null; ms: number; error?: string; s: ReturnType<typeof score>; numbers: ReturnType<typeof unsupportedNumbers> }[] = [];
let next = 0;
async function worker() {
  while (next < cases.length) {
    const i = next++;
    const c = cases[i];
    const r = await ask(c, i);
    const s = score(c, r.answer);
    const numbers = r.answer ? unsupportedNumbers(r.answer) : { checked: false, missing: [] };
    results[i] = { c, ...r, s, numbers };
    const ok = s.outcome && s.facts && s.lang && s.mustNot && s.citation !== false;
    console.log(`${ok ? "PASS" : "FAIL"} ${c.id.padEnd(4)} ${(r.answer?.kind ?? "error").padEnd(11)} ${(r.answer?.mode ?? "").padEnd(13)} ${String(r.ms).padStart(6)}ms  ${c.question}`);
    if (!ok) {
      const why = [!s.outcome && `outcome (want ${c.kinds.join("|")})`, !s.facts && "facts", !s.lang && "language", !s.mustNot && "said something forbidden", s.citation === false && "citation", r.error].filter(Boolean);
      console.log(`       ✗ ${why.join(", ")} — got: ${(r.answer?.shortAnswer ?? "").slice(0, 160)}`);
    }
    if (numbers.missing.length) console.log(`       ⚠ numbers not in cited official text: ${numbers.missing.join(", ")}`);
  }
}
console.log(`Running ${cases.length} cases against ${BASE}\n`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// ---------- PRD metrics ----------
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "n/a");
const answerable = results.filter((r) => r.c.category !== "refuse");
const accurate = answerable.filter((r) => r.s.outcome && r.s.facts && r.s.lang);
const cited = results.filter((r) => r.s.citation !== null);
const citeOk = cited.filter((r) => r.s.citation);
const refuse = results.filter((r) => r.c.category === "refuse");
const refuseOk = refuse.filter((r) => r.s.outcome && r.s.mustNot && r.s.lang);
const numberChecked = results.filter((r) => r.numbers.checked);
const halluc = numberChecked.filter((r) => r.numbers.missing.length);
const times = results.map((r) => r.ms).sort((a, b) => a - b);
const p = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
const under5 = times.filter((t) => t < 5000).length;

const rows = [
  ["Answer accuracy (covered + tricky)", pct(accurate.length, answerable.length), "≥ 90%", `${accurate.length}/${answerable.length}`],
  ["Citation accuracy (expected source cited)", pct(citeOk.length, cited.length), "≥ 95%", `${citeOk.length}/${cited.length}`],
  ["Honest refusal rate", pct(refuseOk.length, refuse.length), "100%", `${refuseOk.length}/${refuse.length}`],
  ["Unsupported numbers (official answers)", String(halluc.length), "0", `${numberChecked.length} answers checked`],
  ["Response time p50 / p90", `${(p(0.5) / 1000).toFixed(1)}s / ${(p(0.9) / 1000).toFixed(1)}s`, "< 5s", `${under5}/${times.length} under 5s`],
];
console.log("\nPRD metrics");
for (const [name, value, target, detail] of rows) console.log(`  ${name.padEnd(44)} ${value.padStart(14)}   target ${target.padEnd(6)}  (${detail})`);
const byMode = results.reduce<Record<string, number>>((m, r) => ((m[r.answer?.mode ?? "error"] = (m[r.answer?.mode ?? "error"] ?? 0) + 1), m), {});
console.log("  Answer sources:", Object.entries(byMode).map(([k, v]) => `${k} ${v}`).join(", "));

const out = path.join(process.cwd(), "evals", `results-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(out, JSON.stringify({ base: BASE, ranAt: new Date().toISOString(), metrics: rows, results: results.map((r) => ({ id: r.c.id, ms: r.ms, score: r.s, numbers: r.numbers, error: r.error, answer: r.answer })) }, null, 1));
console.log(`\nFull results: ${path.relative(process.cwd(), out)}`);
