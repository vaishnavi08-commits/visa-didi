// Keyword (BM25) retrieval over stored chunks, scoped to the destination.
// The PRD leaves the embedding model open; this is the zero-cost stand-in until pgvector is wired up.
import { isUsable, type Chunk, type Store } from "./store";

const STOP = new Set(
  "a an the and or of to for in on at by is are be do does i my me we our you your it this that with as from can need needs will what which how when who there their any have has get going go visit visiting".split(" "),
);

const SYNONYMS: Record<string, string[]> = {
  fee: ["fees", "cost", "charge", "charges", "price", "pay", "payment"],
  documents: ["document", "documents", "checklist", "papers", "require", "required", "requirements"],
  processing: ["processing", "process", "time", "days", "weeks", "decision", "long"],
  exemption: ["exempt", "exemption", "visa-free", "free", "without"],
  arrival: ["arrival", "voa", "on-arrival"],
  business: ["business", "meeting", "meetings", "conference", "conferences", "client", "trade", "seminar"],
  stay: ["stay", "duration", "days", "period", "valid", "validity"],
  passport: ["passport", "validity", "valid", "months", "blank", "pages"],
  evisa: ["evisa", "e-visa", "online", "electronic", "eta", "apply"],
};

function tokenize(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9£$€\- ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function expand(tokens: string[]) {
  const out = new Set(tokens);
  for (const t of tokens) for (const group of Object.values(SYNONYMS)) if (group.includes(t)) group.forEach((g) => out.add(g));
  return [...out];
}

// The most relevant few lines of a chunk, for showing official text directly.
export function bestSnippet(chunk: Chunk, query: string, maxChars = 480) {
  const q = new Set(expand(tokenize(query)));
  const lines = chunk.text.split("\n").filter(Boolean);
  let best = 0, bestScore = -1;
  lines.forEach((l, i) => {
    const toks = tokenize(l);
    let score = toks.filter((t) => q.has(t)).length + (/\bindia(n)?\b/i.test(l) ? 2 : 0);
    if (toks.length < 4) score -= 1;
    if (score > bestScore) { bestScore = score; best = i; }
  });
  let out = "";
  for (let i = best; i < lines.length && out.length < maxChars; i++) out += (out ? " " : "") + lines[i];
  return out.length > maxChars ? out.slice(0, maxChars).replace(/\s\S*$/, "") + " …" : out;
}

export type Retrieved = Chunk & { score: number };

export function retrieve(store: Store, destinationIds: string[], query: string, k = 8): Retrieved[] {
  const pool = store.chunks.filter((c) => {
    const src = store.sources[c.sourceId];
    return destinationIds.includes(c.destinationId) && src && isUsable(src);
  });
  if (!pool.length) return [];

  const docs = pool.map((c) => tokenize(c.heading + " " + c.heading + " " + c.text));
  const avgLen = docs.reduce((n, d) => n + d.length, 0) / docs.length;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);

  const qTokens = expand(tokenize(query));
  const k1 = 1.2, b = 0.75, N = docs.length;
  const scored = pool.map((c, i) => {
    const d = docs[i];
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const q of qTokens) {
      const f = tf.get(q);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(q) ?? 0) + 0.5) / ((df.get(q) ?? 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgLen)));
    }
    // Pages that mention India specifically are more likely to hold the rule that applies.
    if (/\bindia(n)?\b/i.test(c.text)) score *= 1.3;
    return { ...c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  // Comparing two destinations: give each its fair share of the context.
  const perDest = Math.ceil(k / destinationIds.length);
  return destinationIds.flatMap((id) => scored.filter((c) => c.destinationId === id).slice(0, perDest));
}
