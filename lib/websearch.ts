// Gap filler: when the stored official pages can't answer, Claude searches the web live.
// Answers built this way are labelled as web-sourced and only keep sources Claude actually cited.
import Anthropic from "@anthropic-ai/sdk";
import type { Destination } from "./destinations";

export type WebSource = { url: string; title: string; official: boolean };

export type WebResult = {
  found: boolean;
  shortAnswer: string;
  details: { text: string; sources: string[] }[]; // sources = urls
  sources: WebSource[];
  usage: { input: number; output: number; searches: number };
};

const MODEL = "claude-opus-5-5";

// Government, embassy and EU domains count as official even when found through search.
const OFFICIAL_HOST = /(\.gov(\.[a-z]{2})?$|\.gov\.[a-z]{2}$|\.go\.[a-z]{2}$|\.gouv\.[a-z]{2}$|\.gob\.[a-z]{2}$|europa\.eu$|^u\.ae$|\.u\.ae$|\.mofa\.|embassy|mfa\.|immi\.homeaffairs\.gov\.au$|^gov\.uk$|\.gov\.uk$|mea\.gov\.in$|state\.gov$)/i;

export function isOfficialUrl(url: string) {
  try {
    return OFFICIAL_HOST.test(new URL(url).hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

const SYSTEM = `You are Visa Didi: a warm, no-nonsense elder sister who helps Indian passport holders understand visa and entry rules for tourist and short business trips.

Search the web to answer. Prefer, in order: the destination's government immigration or e-visa site, its embassy or consulate in India, India's Ministry of External Affairs, then well-known travel sources (airlines, IATA, established travel publications). Visa rules change often: prefer the most recent information, and say so if sources disagree or look out of date.

Assume an ordinary Indian passport. Never invent anything; every fact must come from a page you found. If you cannot find a reliable answer, say so plainly. Never predict whether a visa will be approved.

Reply in exactly this format and nothing else:
SHORT: <one or two sentences, direct answer first>
- <key detail, only what the question needs: visa type, documents, fees, processing time, stay length, passport validity>
- <more details as needed, at most 5>
If you could not find a reliable answer, reply with a single line:
SHORT: NOT_FOUND`;

let client: Anthropic | null = null;

export async function webAnswer(question: string, history: { role: "user" | "assistant"; text: string }[], dests: Destination[]): Promise<WebResult> {
  client ??= new Anthropic();
  const context = history.slice(-4).map((t) => `${t.role === "user" ? "Traveller" : "Didi"}: ${t.text}`).join("\n");
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `${context ? `Earlier in the chat:\n${context}\n\n` : ""}Destination: ${dests.map((d) => d.name).join(", ")}\nQuestion: ${question}`,
    },
  ];
  const usage = { input: 0, output: 0, searches: 0 };
  let response: Anthropic.Beta.BetaMessage | null = null;

  // Server-side search can pause a long turn; resume it a couple of times.
  for (let i = 0; i < 3; i++) {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      messages,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3, user_location: { type: "approximate", country: "IN" } }],
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    usage.searches += response.usage.server_tool_use?.web_search_requests ?? 0;
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  const empty: WebResult = { found: false, shortAnswer: "", details: [], sources: [], usage };
  if (!response || response.stop_reason === "refusal") return empty;

  const parsed = parseWebContent(response.content);
  return parsed ? { found: true, ...parsed, usage } : empty;
}

// Turns Claude's cited reply into a short answer, details and their sources.
export function parseWebContent(content: Anthropic.Beta.BetaContentBlock[]) {
  // Walk the text blocks, keeping each line's citations so details stay tied to their pages.
  type Line = { text: string; urls: Set<string> };
  const lines: Line[] = [{ text: "", urls: new Set() }];
  const titles = new Map<string, string>();
  for (const block of content) {
    if (block.type !== "text") continue;
    const urls: string[] = [];
    for (const c of block.citations ?? []) {
      if (c.type === "web_search_result_location") {
        urls.push(c.url);
        titles.set(c.url, c.title ?? new URL(c.url).hostname);
      }
    }
    const parts = block.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push({ text: "", urls: new Set() });
      const cur = lines[lines.length - 1];
      cur.text += part;
      urls.forEach((u) => cur.urls.add(u));
    });
  }

  const clean = lines.map((l) => ({ text: l.text.trim(), urls: [...l.urls] })).filter((l) => l.text);
  const shortIdx = clean.findIndex((l) => l.text.startsWith("SHORT:"));
  if (shortIdx < 0) return null;
  const shortAnswer = clean[shortIdx].text.replace(/^SHORT:\s*/, "");
  if (/NOT_FOUND/.test(shortAnswer)) return null;

  const details = clean
    .slice(shortIdx + 1)
    .filter((l) => /^[-•*]\s/.test(l.text))
    .map((l) => ({ text: l.text.replace(/^[-•*]\s*/, ""), sources: l.urls }));
  const cited = new Set([...clean[shortIdx].urls, ...details.flatMap((d) => d.sources)]);
  // No citations means nothing to back the answer: treat it as not found.
  if (!cited.size) return null;

  const sources = [...cited].map((url) => ({ url, title: titles.get(url) ?? url, official: isOfficialUrl(url) }));
  // Official pages first.
  sources.sort((a, b) => Number(b.official) - Number(a.official));
  return { shortAnswer, details: details.filter((d) => d.sources.length), sources };
}
