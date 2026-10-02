// Per-question flow: guardrails → retrieve official chunks → Claude writes a cited answer.
// When the stored official pages can't answer, Claude searches the web live (labelled as such).
// Without an API key, the official text is shown directly.
import Anthropic from "@anthropic-ai/sdk";
import { DESTINATIONS, displayName, type Destination } from "./destinations";
import { detectLang, englishTopicTerms, MESSAGES, writingInstruction, type Lang } from "./language";
import { bestSnippet, retrieve, type Retrieved } from "./retrieve";
import { route } from "./router";
import { addSpend, cacheGet, cacheSet, spent } from "./persist";
import { getStore, isStale, isUsable, recentlyUpdated, type Store } from "./store";
import { costUsd, MODEL, modelOptions } from "./model";
import { webAnswer } from "./websearch";

export type AnswerSource = {
  id: string;
  title: string;
  authority: string;
  url: string;
  lastVerified: string;
  stale: boolean;
  recentlyUpdated: boolean;
  manual: boolean;
  // "stored": a page from the weekly-checked official list. "web": found by live search.
  origin: "stored" | "web";
  official: boolean;
};

export type AnswerKind =
  | "answered"
  | "partial"
  | "not_covered"
  | "clarify"
  | "judgment"
  | "refused"
  | "off_topic"
  | "unavailable"
  | "limit";

export type Answer = {
  kind: AnswerKind;
  shortAnswer: string;
  details: { text: string; sources: string[] }[];
  notCovered?: string;
  conflict?: string;
  sources: AnswerSource[];
  officialLink?: { label: string; url: string };
  mode: "ai" | "web" | "official_text" | "rule";
  // Whether to show the "confirm on the official site before booking" line.
  verifyLine: boolean;
  // Why live web search didn't produce an answer, if it was tried (diagnostics only).
  webIssue?: string;
  // Language the answer is written in (drives the read-aloud voice).
  lang: Lang;
  // The official pages don't fully answer this; the card offers "Search the web for more".
  canSearchWeb?: boolean;
  // A web search was run on request but found nothing reliable.
  webSearched?: boolean;
  // True when AI answers failed (e.g. API credits ran out) and the official text is shown instead.
  fallback?: boolean;
  // Signature that lets /api/speak voice this answer in Didi's own voice (set by the API route).
  speakToken?: string;
  // When official pages only partly answer: what live web search found for the rest.
  webExtra?: { shortAnswer: string; details: { text: string; sources: string[] }[] };
};

// kind is sent for Didi's turns, so a reply to a follow-up question can be recognised.
export type Turn = { role: "user" | "assistant"; text: string; kind?: string };



const coveredList = (lang: Lang) => DESTINATIONS.map((d) => displayName(d, lang)).join(", ");
const siteLink = (d: Destination, lang: Lang) => ({ label: MESSAGES.official_site[lang](displayName(d, lang)), url: d.officialLink });

function rule(kind: AnswerKind, shortAnswer: string, extra: Partial<Answer> = {}): Answer {
  return { kind, shortAnswer, details: [], sources: [], mode: "rule", verifyLine: false, lang: "en", ...extra };
}

function toAnswerSource(store: Store, sourceId: string): AnswerSource | null {
  const s = store.sources[sourceId];
  if (!s || !s.lastVerified) return null;
  return {
    id: s.id,
    title: s.title,
    authority: s.authority,
    url: s.url,
    lastVerified: s.lastVerified,
    stale: isStale(s),
    recentlyUpdated: recentlyUpdated(store, s.id),
    manual: s.method === "manual",
    origin: "stored",
    official: true,
  };
}

// ---------- Claude ----------

const SYSTEM = `You are Visa Didi: a warm, no-nonsense elder sister who helps Indian passport holders understand visa and entry rules for tourist and short business trips. You tell people straight, in plain, friendly English.

The single most important rule: you answer ONLY from the official source excerpts provided in <sources>. Never add facts from your own general knowledge, even if you are confident — rules change and a confident wrong answer can cost someone their trip. If the excerpts do not state something, it is not covered.

People use everyday words, not official visa names: "tourist visa" usually means the country's short-stay visitor visa, and "business trip" or "conference" are activities. Match the person's words to the official category in the excerpts, and if that category covers the activity (e.g. a short-term stay "for tourism, business, visiting friends"), answer from it plainly.

Assume the traveller holds an ordinary Indian passport. Excerpts may describe rules for many nationalities; only use what clearly applies to Indian passport holders (or to all nationalities). If an excerpt says a list of countries applies but the list itself is not in the excerpts, you cannot tell whether India is on it — say so.

How to choose a status:
- "answered": the excerpts clearly answer the question.
- "partial": they answer part of it. Answer that part and put what is missing in not_covered.
- "not_covered": they don't answer it. short_answer says you couldn't find this in the official sources.
- "clarify": only when the destination or trip purpose (tourism vs business) is missing AND the excerpts show it changes the answer AND you can't simply answer each case in a sentence. Ask ONE short question in clarify_question. Prefer answering: if you can cover both cases briefly (e.g. "For tourism…; for a work trip…"), do that instead of asking.
- "judgment": the person asks whether they will be approved or their chances. Don't predict; short_answer explains that only the issuing authority decides, and details list what the official requirements are (from the excerpts).

Writing rules — keep it simple and short; most people read this on a phone:
- short_answer: at most two short sentences (about 30 words), plain everyday words, the direct answer first (e.g. "Yes, you need an e-visa. Apply online before you travel.").
- details: only facts the question asked for or truly needs (documents, fees, processing time, length of stay, passport validity, purpose rules). At most 3 items, each one short sentence (about 15 words). Don't repeat the short answer. Leave details empty if the short answer already says it all. Each detail cites the source labels it comes from, e.g. ["S2"].
- not_covered: one short sentence, and only about something the person actually asked. Otherwise an empty string.
- Never explain how you work, what "the excerpts" are, or which pages you were given.
- source_ids: every label the short answer relies on.
- If two sources disagree, describe both in conflict and don't pick one.
- Quote amounts, durations and dates exactly as the excerpts give them.
- Questions unrelated to visas or entry rules: status not_covered with a short friendly steer back.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "short_answer", "details", "source_ids", "not_covered", "conflict", "clarify_question"],
  properties: {
    status: { type: "string", enum: ["answered", "partial", "not_covered", "clarify", "judgment"] },
    short_answer: { type: "string" },
    details: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "source_ids"],
        properties: { text: { type: "string" }, source_ids: { type: "array", items: { type: "string" } } },
      },
    },
    source_ids: { type: "array", items: { type: "string" } },
    not_covered: { type: "string", description: "What the sources do not cover, or empty string." },
    conflict: { type: "string", description: "Describe disagreeing sources, or empty string." },
    clarify_question: { type: "string", description: "One short follow-up question, or empty string." },
  },
} as const;

type ModelOutput = {
  status: "answered" | "partial" | "not_covered" | "clarify" | "judgment";
  short_answer: string;
  details: { text: string; source_ids: string[] }[];
  source_ids: string[];
  not_covered: string;
  conflict: string;
  clarify_question: string;
};

let client: Anthropic | null = null;

// Hard caps on API spend: whichever runs out first (defaults $0.50 a day, $5 a month).
async function budgetLeft() {
  const s = await spent();
  return Math.min(
    Number(process.env.DAILY_BUDGET_USD ?? 0.5) - s.today,
    Number(process.env.MONTHLY_BUDGET_USD ?? 5) - s.month,
  );
}

async function askClaude(question: string, history: Turn[], chunks: Retrieved[], store: Store, dests: Destination[], lang: Lang, deadline: number, noClarify = false) {
  client ??= new Anthropic();
  const labelled = chunks.map((c, i) => ({ label: `S${i + 1}`, chunk: c }));
  const sourcesXml = labelled
    .map(({ label, chunk }) => {
      const s = store.sources[chunk.sourceId];
      return `<source label="${label}" page="${s.title}" authority="${s.authority}" url="${s.url}" last_verified="${s.lastVerified}">\n${chunk.heading ? `Section: ${chunk.heading}\n` : ""}${chunk.text}\n</source>`;
    })
    .join("\n\n");

  // Earlier turns give follow-ups their context; roles must alternate starting with the user.
  const turns: Turn[] = [];
  for (const t of history.slice(-6)) {
    const last = turns[turns.length - 1];
    if (!last && t.role === "assistant") continue;
    if (last && last.role === t.role) last.text += "\n" + t.text;
    else turns.push({ ...t });
  }
  if (turns.length && turns[turns.length - 1].role === "user") turns.pop();
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t) => ({ role: t.role, content: t.text }));
  messages.push({
    role: "user",
    content: `Destination(s) detected: ${dests.map((d) => d.name).join(", ")}\n\n<sources>\n${sourcesXml}\n</sources>\n\nQuestion: ${question}${noClarify ? "\n\nYou already asked a follow-up question and the person answered it. Do not ask another: answer now (status must not be \"clarify\"), stating any assumption in one short phrase." : ""}\n\nLanguage: ${writingInstruction(lang)}`,
  });

  const { effort, ...options } = modelOptions();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages,
    output_config: { ...(effort ? { effort } : {}), format: { type: "json_schema", schema: SCHEMA } },
    ...options,
    // Stay inside the request's time budget; a silent retry could push past the server's limit.
  }, { timeout: Math.max(3_000, deadline - Date.now() - 2_000), maxRetries: 0 });

  await addSpend(costUsd(response.usage.input_tokens, response.usage.output_tokens));
  if (response.stop_reason === "refusal") return null;
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    return { out: JSON.parse(text) as ModelOutput, labelled };
  } catch {
    return null;
  }
}

// ---------- Official-text mode (no API key) ----------

function officialTextAnswer(question: string, chunks: Retrieved[], store: Store, dests: Destination[], judgment: boolean): Answer {
  const picked: Retrieved[] = [];
  for (const c of chunks) {
    // Keep the no-AI fallback short too: just the single most relevant passage, about two lines.
    if (picked.length >= 1) break;
    if (c.score <= 0) continue;
    if (!picked.some((p) => p.sourceId === c.sourceId)) picked.push(c);
  }
  if (!picked.length) {
    return rule("not_covered", `I couldn't find this in the official ${dests.map((d) => d.name).join(" / ")} sources I have.`, {
      officialLink: { label: `${dests[0].name} official site`, url: dests[0].officialLink },
      verifyLine: true,
    });
  }
  const sourceIds = [...new Set(picked.map((p) => p.sourceId))];
  return {
    kind: judgment ? "judgment" : "answered",
    shortAnswer: judgment
      ? "I can't predict whether a visa will be approved — only the issuing authority decides. Here's what the official pages say about the requirements:"
      : `Here's what the official ${dests.map((d) => d.name).join(" / ")} pages say:`,
    details: picked.map((p) => ({ text: (p.heading ? `${p.heading} — ` : "") + bestSnippet(p, question, 220), sources: [p.sourceId] })),
    sources: sourceIds.map((id) => toAnswerSource(store, id)).filter((s): s is AnswerSource => !!s),
    mode: "official_text",
    verifyLine: true,
    lang: "en",
  };
}

// ---------- Entry point ----------


export async function answerQuestion(question: string, history: Turn[], opts: { web?: boolean } = {}): Promise<Answer> {
  // Answer in the language of the question (English, Hindi or Hinglish).
  const lang = detectLang(question);
  const answer = await answerIn(question, history, lang, !!opts.web);
  // Official-text mode quotes English pages as they are.
  return answer.mode === "official_text" ? answer : { ...answer, lang };
}

// The API route may run for 60 s; leave room to send the reply.
const TIME_BUDGET_MS = 52_000;

// A short reply to Didi's own follow-up question ("employer", "Japan") is not a new question:
// it completes the original one. Returns the combined question (for Claude) and the text to route on
// (the person's own words only, so Didi's question can't trigger a refusal), or null.
function completeFollowUp(reply: string, history: Turn[]): { question: string; routeText: string } | null {
  const last = history[history.length - 1];
  if (last?.role !== "assistant" || last.kind !== "clarify") return null;
  if (reply.trim().split(/\s+/).length > 10) return null;
  const original = [...history].reverse().find((t) => t.role === "user");
  if (!original) return null;
  return {
    question: `${original.text} (My answer to your follow-up question "${last.text}": ${reply.trim()})`,
    routeText: `${original.text} ${reply.trim()}`,
  };
}

async function answerIn(asked: string, history: Turn[], lang: Lang, wantWeb: boolean): Promise<Answer> {
  const deadline = Date.now() + TIME_BUDGET_MS;
  // Didi asks at most one follow-up question; after the person replies, it must answer.
  const completed = completeFollowUp(asked, history);
  const question = completed?.question ?? asked;
  const noClarify = !!completed;
  const r = route(completed?.routeText ?? asked, history.filter((t) => t.role === "user").map((t) => t.text));

  switch (r.kind) {
    case "greeting":
      return rule("off_topic", MESSAGES.greeting[lang]);
    case "thanks":
      return rule("off_topic", MESSAGES.thanks[lang]);
    case "off_topic":
      return rule("off_topic", MESSAGES.off_topic[lang]);
    case "ask_destination":
      return rule("clarify", MESSAGES.ask_destination[lang](coveredList(lang)));
    case "uncovered_destination":
      return rule("refused", MESSAGES.uncovered[lang](titleCase(r.name), coveredList(lang)));
    case "out_of_scope_visa":
      return rule("refused", MESSAGES.out_of_scope[lang](MESSAGES.out_of_scope_what[r.what]?.[lang] ?? r.what));
    case "other_passport":
      return rule("refused", MESSAGES.other_passport[lang]);
  }

  const store = await getStore();
  const dests = r.destinations;
  const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const link = siteLink(dests[0], lang);

  const baseKey = JSON.stringify([dests.map((d) => d.id), question.toLowerCase().replace(/\s+/g, " ").trim(), r.judgment, lang]);
  const cacheKey = wantWeb ? `${baseKey}:web` : baseKey;
  // Repeated first questions are served from the shared cache (follow-ups depend on the chat).
  if (history.length === 0) {
    const hit = await cacheGet<Answer>(cacheKey);
    if (hit) return hit;
  }
  const remember = async (key: string, answer: Answer) => {
    if (history.length === 0) await cacheSet(key, answer);
    return answer;
  };

  if (hasKey && (await budgetLeft()) <= 0) {
    return rule("limit", MESSAGES.limit[lang], { officialLink: link });
  }

  const usableDests = dests.filter((d) => d.sources.some((s) => store.sources[s.id] && isUsable(store.sources[s.id])));

  // No official pages at all for this destination: search the web straight away rather than
  // offering a button (the answer has to come from the web either way).
  if (!usableDests.length && hasKey && !wantWeb) return answerIn(asked, history, lang, true);

  // Step 1: the answer from stored official pages (reused from the cache when the person asks for a web search).
  let official: Answer | null = null;
  if (usableDests.length) {
    const priorUser = history.filter((t) => t.role === "user").slice(-1).map((t) => t.text).join(" ");
    // Hindi / Hinglish questions also search with English topic words, since the official pages are in English.
    const chunks = retrieve(store, usableDests.map((d) => d.id), `${question} ${englishTopicTerms(`${question} ${priorUser}`)} ${findsPurpose(priorUser)}`, 5);
    if (!hasKey) return officialTextAnswer(question, chunks, store, usableDests, r.judgment);

    if (wantWeb && history.length === 0) official = await cacheGet<Answer>(baseKey);
    if (!official) {
      let aiIssue: string | undefined;
      const result = await askClaude(question, history, chunks, store, usableDests, lang, deadline, noClarify).catch((e) => {
        console.error("official answer failed", e);
        aiIssue = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        return null;
      });
      if (!result) {
        // Not cached: once the AI call works again, the question should get a real answer.
        return { ...officialTextAnswer(question, chunks, store, usableDests, r.judgment), fallback: true, webIssue: aiIssue };
      }
      official = toAnswer(result.out, result.labelled, store, usableDests, lang, noClarify);
      const gap = official.kind === "not_covered" || official.kind === "partial";
      official = await remember(baseKey, { ...official, canSearchWeb: hasKey && gap });
    }
  }

  const covered = official && official.kind !== "not_covered" && official.kind !== "partial";
  if (covered) return official!;
  const nothing = rule("unavailable", MESSAGES.unavailable[lang](displayName(dests[0], lang)), { officialLink: link });

  // Step 2 (only when asked): search the web for what the official pages don't cover.
  // Web search is the costly part, so it runs only when the person taps "Search the web for more".
  if (!wantWeb || !hasKey) {
    if (official) return official;
    if (!hasKey) return nothing;
    return remember(baseKey, { ...nothing, shortAnswer: MESSAGES.unavailable_offer[lang](displayName(dests[0], lang)), canSearchWeb: true });
  }

  if (!official || official.kind === "not_covered") {
    const web = await tryWeb(question, history, dests, lang, deadline);
    if (web) return remember(cacheKey, web);
    return { ...(official ?? nothing), canSearchWeb: false, webSearched: true, webIssue: lastWebIssue };
  }

  // Partly covered: keep the official answer and add what the web says about the rest.
  const gap = official.notCovered ? `\n(The official pages already answered part of this. Focus on what they did not cover: ${official.notCovered})` : "";
  const web = await tryWeb(question + gap, history, dests, lang, deadline);
  if (!web) return { ...official, canSearchWeb: false, webSearched: true, webIssue: lastWebIssue };
  const known = new Set(official.sources.map((s) => s.id));
  return remember(cacheKey, {
    ...official,
    canSearchWeb: false,
    webExtra: { shortAnswer: web.shortAnswer, details: web.details },
    sources: [...official.sources, ...web.sources.filter((s) => !known.has(s.id))],
  });
}

let lastWebIssue: string | undefined;

async function tryWeb(question: string, history: Turn[], dests: Destination[], lang: Lang, deadline: number): Promise<Answer | null> {
  const timeLeft = deadline - Date.now();
  // Not enough time for a search: skip it rather than have the whole request time out.
  if (timeLeft < 12_000) {
    lastWebIssue = "skipped: not enough time left";
    return null;
  }
  try {
    const web = await Promise.race([
      webAnswer(question, history, dests, writingInstruction(lang), deadline),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("web search timed out")), timeLeft)),
    ]);
    await addSpend(costUsd(web.usage.input, web.usage.output, web.usage.searches));
    if (!web.found) {
      lastWebIssue = web.reason ?? "not found";
      return null;
    }
    const today = new Date().toISOString().slice(0, 10);
    return {
      kind: "answered",
      shortAnswer: web.shortAnswer,
      details: web.details,
      sources: web.sources.map((s) => ({
        id: s.url,
        title: s.title,
        authority: hostname(s.url),
        url: s.url,
        lastVerified: today,
        stale: false,
        recentlyUpdated: false,
        manual: false,
        origin: "web",
        official: s.official,
      })),
      officialLink: siteLink(dests[0], lang),
      mode: "web",
      verifyLine: true,
      lang,
    };
  } catch (e) {
    console.error("web search failed", e);
    lastWebIssue = `error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400);
    return null;
  }
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function toAnswer(out: ModelOutput, labelled: { label: string; chunk: Retrieved }[], store: Store, dests: Destination[], lang: Lang, noClarify = false): Answer {
  const byLabel = new Map(labelled.map((l) => [l.label, l.chunk.sourceId]));
  // Only citations that point at excerpts we actually sent are kept.
  const resolve = (ids: string[]) => [...new Set(ids.map((id) => byLabel.get(id)).filter((x): x is string => !!x))];

  const details = out.details
    .map((d) => ({ text: d.text, sources: resolve(d.source_ids) }))
    .filter((d) => d.sources.length > 0)
    .slice(0, 3);
  const usedIds = [...new Set([...resolve(out.source_ids), ...details.flatMap((d) => d.sources)])];
  const sources = usedIds.map((id) => toAnswerSource(store, id)).filter((s): s is AnswerSource => !!s);
  const link = siteLink(dests[0], lang);

  if (out.status === "clarify") {
    // Never a second follow-up in a row: say honestly that the official pages don't settle it.
    if (noClarify) {
      return rule("not_covered", MESSAGES.not_covered[lang](dests.map((d) => displayName(d, lang)).join(" / ")), {
        officialLink: link, mode: "ai", verifyLine: true,
      });
    }
    return rule("clarify", out.clarify_question || out.short_answer, { mode: "ai" });
  }
  // A substantive answer with no valid citation is treated as not covered — never shown uncited.
  if ((out.status === "answered" || out.status === "partial") && sources.length === 0) {
    return rule("not_covered", MESSAGES.not_covered[lang](dests.map((d) => displayName(d, lang)).join(" / ")), {
      officialLink: link, mode: "ai", verifyLine: true,
    });
  }
  return {
    kind: out.status,
    shortAnswer: out.short_answer,
    details,
    notCovered: out.not_covered || undefined,
    conflict: out.conflict || undefined,
    sources,
    officialLink: out.status === "not_covered" || out.status === "partial" ? link : undefined,
    mode: "ai",
    verifyLine: true,
    lang,
  };
}

function findsPurpose(text: string) {
  return /business|meeting|conference|client/i.test(text) ? "business" : "";
}

function titleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
