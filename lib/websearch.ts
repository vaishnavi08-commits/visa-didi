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
  // Why no answer was produced (for diagnosing; never shown in the UI).
  reason?: string;
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

Search the web to answer. Be quick: one well-chosen search is usually enough; search again only if the first results don't answer the question. Prefer, in order: the destination's government immigration or e-visa site, its embassy or consulate in India, India's Ministry of External Affairs, then well-known travel sources (airlines, IATA, established travel publications). Visa rules change often: prefer the most recent information, and say so if sources disagree or look out of date.

Assume an ordinary Indian passport. Never invent anything; every fact must come from a page you found. If you cannot find a reliable answer, say so plainly. Never predict whether a visa will be approved.

Reply in exactly this format and nothing else. End the SHORT line and every bullet with the exact URL of the search result it came from, in square brackets:
SHORT: <one or two sentences, direct answer first> [source: <url>]
- <key detail, only what the question needs: visa type, documents, fees, processing time, stay length, passport validity> [source: <url>]
- <more details as needed, at most 4 bullets in total, one short sentence each> [source: <url>]
If you could not find a reliable answer, reply with a single line:
SHORT: NOT_FOUND`;

let client: Anthropic | null = null;

export async function webAnswer(
  question: string,
  history: { role: "user" | "assistant"; text: string }[],
  dests: Destination[],
  languageInstruction: string,
  deadline: number,
): Promise<WebResult> {
  client ??= new Anthropic();
  const context = history.slice(-4).map((t) => `${t.role === "user" ? "Traveller" : "Didi"}: ${t.text}`).join("\n");
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `${context ? `Earlier in the chat:\n${context}\n\n` : ""}Destination: ${dests.map((d) => d.name).join(", ")}\nQuestion: ${question}\n\nLanguage: ${languageInstruction} Keep the SHORT: marker and [source: url] links exactly as specified.`,
    },
  ];
  const usage = { input: 0, output: 0, searches: 0 };
  let response: Anthropic.Beta.BetaMessage | null = null;

  // Server-side search can pause a long turn; resume it a couple of times.
  for (let i = 0; i < 3; i++) {
    const timeLeft = deadline - Date.now() - 1_000;
    if (timeLeft < 3_000) break;
    response = await client.beta.messages.create({
      model: MODEL,
      // Kept short on purpose: a brief answer is faster to write.
      max_tokens: 1500,
      system: SYSTEM,
      messages,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 2, user_location: { type: "approximate", country: "IN" } }],
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    }, { timeout: timeLeft, maxRetries: 0 });
    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    usage.searches += response.usage.server_tool_use?.web_search_requests ?? 0;
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  const empty: WebResult = { found: false, shortAnswer: "", details: [], sources: [], usage };
  if (!response || response.stop_reason === "refusal") return { ...empty, reason: `stop=${response?.stop_reason}` };

  const parsed = parseWebContent(response.content);
  if (!parsed) {
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const citations = response.content.reduce((n, b) => n + (b.type === "text" ? (b.citations?.length ?? 0) : 0), 0);
    const reason = `rejected: stop=${response.stop_reason} searches=${usage.searches} blocks=${response.content.map((b) => b.type).join(",")} citations=${citations} text=${JSON.stringify(text.slice(0, 400))}`;
    console.warn("web answer rejected", reason);
    return { ...empty, reason };
  }
  return { found: true, ...parsed, usage };
}

// Turns Claude's cited reply into a short answer, details and their sources.
export function parseWebContent(content: Anthropic.Beta.BetaContentBlock[]) {
  // Pages the search actually returned. A [source: url] the model writes only counts if it's one of these.
  const titles = new Map<string, string>();
  const found = new Map<string, string>(); // normalized url -> url
  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) {
        if (r.type === "web_search_result") {
          found.set(normalizeUrl(r.url), r.url);
          titles.set(r.url, r.title);
        }
      }
    }
  }

  // Walk the text blocks, keeping each line's citations so details stay tied to their pages.
  type Line = { text: string; urls: Set<string> };
  const lines: Line[] = [{ text: "", urls: new Set() }];
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

  // Written source markers (used when the search mode returns no inline citations).
  for (const l of lines) {
    // [source: url] as asked, or (source: url) which the model sometimes writes instead.
    l.text = l.text.replace(/[[(]\s*sources?\s*:\s*([^\])]*)[\])]/gi, (_, list: string) => {
      for (const raw of list.split(/[\s,]+/)) {
        const url = found.get(normalizeUrl(raw.replace(/[).;]+$/, "")));
        if (url) l.urls.add(url);
      }
      return "";
    }).replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s+([.,;])/g, "$1");
  }

  // Tolerate markdown the model may add: **SHORT:**, headings, numbered lists.
  const clean = lines
    .map((l) => ({ text: l.text.replace(/\*\*/g, "").replace(/^#+\s*/, "").replace(/^\d+[.)]\s+/, "- ").trim(), urls: [...l.urls] }))
    .filter((l) => l.text);
  let shortIdx = clean.findIndex((l) => /^SHORT\s*:/i.test(l.text));
  // No marker at all: fall back to the first cited line as the short answer.
  if (shortIdx < 0) shortIdx = clean.findIndex((l) => l.urls.length > 0);
  if (shortIdx < 0) return null;
  const shortAnswer = clean[shortIdx].text.replace(/^SHORT\s*:\s*/i, "");
  if (/NOT_FOUND/.test(shortAnswer)) return null;

  const details = clean
    .slice(shortIdx + 1)
    // Bullets, or any later line that carries a citation.
    .filter((l) => /^[-•*]\s/.test(l.text) || l.urls.length > 0)
    .map((l) => ({ text: l.text.replace(/^[-•*]\s*/, ""), sources: l.urls }));
  const cited = new Set([...clean[shortIdx].urls, ...details.flatMap((d) => d.sources)]);
  // No citations means nothing to back the answer: treat it as not found.
  if (!cited.size) return null;

  const sources = [...cited].map((url) => ({ url, title: titles.get(url) ?? url, official: isOfficialUrl(url) }));
  // Official pages first.
  sources.sort((a, b) => Number(b.official) - Number(a.official));
  return { shortAnswer, details: details.filter((d) => d.sources.length), sources };
}

function normalizeUrl(url: string) {
  try {
    const u = new URL(url.trim());
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "") + u.search).toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}
