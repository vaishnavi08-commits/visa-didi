// The weekly loop: fetch each official page, compare with the stored version,
// re-chunk on change, log changes, and flag failures. It never touches answers directly.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { allSources } from "./destinations";
import { db, loadStoreFromDb, saveRecheckToDb } from "./db";
import { clearAnswerCache } from "./persist";
import { forgetStoreCache, loadStore, saveStore, type Chunk, type Store } from "./store";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const MIN_TEXT_CHARS = 600; // anything shorter is a JS shell or block page, not real content
const CHUNK_CHARS = 1400;

type FetchResult =
  | { ok: true; sections: { heading: string; text: string }[] }
  | { ok: false; gone: boolean; error: string };

export function htmlToSections(html: string): { heading: string; text: string }[] {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, select, button, input, textarea, nav, header, footer, aside, [role=navigation], [aria-hidden=true]").remove();
  $(".breadcrumb, .breadcrumbs, .cookie, .skip-link, .menu, .sidebar").remove();
  const root = $("main").length ? $("main").first() : $("article").length ? $("article").first() : $("body");

  const sections: { heading: string; text: string }[] = [];
  let current = { heading: $("h1").first().text().trim() || "", text: "" };
  root.find("h1, h2, h3, h4, p, li, td, th, dt, dd, div").each((_, el) => {
    const tag = el.tagName.toLowerCase();
    const $el = $(el);
    // Skip containers whose text is captured by a nested block we also visit.
    if (["li", "td", "th", "dd"].includes(tag) && $el.find("p, li, div, table").length) return;
    // Many government CMSs put body text in bare <div>s: take only leaf divs not inside another block.
    let t: string;
    if (tag === "div") {
      if ($el.parents("p, li, dd, dt").length) return;
      const hasBlocks = $el.find("div, p, ul, ol, table, h1, h2, h3, h4, section, article, dl").length > 0;
      // Container divs: keep only their own loose text (text nodes and inline tags), not their children's.
      t = (hasBlocks ? $el.contents().filter((_, n) => n.type === "text" || INLINE.has((n as { name?: string }).name ?? "")).text() : $el.text())
        .replace(/\s+/g, " ").trim();
      if (hasBlocks && t.length < 40) return;
    } else {
      t = $el.text().replace(/\s+/g, " ").trim();
    }
    if (!t) return;
    if (/^h[1-4]$/.test(tag)) {
      if (current.text.trim()) sections.push(current);
      current = { heading: t, text: "" };
      return;
    }
    // Drop navigation-like crumbs ("• Home", "» Visa") but keep short table values like fees.
    if (tag === "li" && t.split(" ").length <= 3 && !/\d/.test(t)) return;
    if (t === "»" || t === "›") return;
    current.text += (tag === "li" ? "• " : "") + t + "\n";
  });
  if (current.text.trim()) sections.push(current);
  return sections;
}

const INLINE = new Set(["span", "a", "b", "strong", "em", "i", "u", "font", "br", "small", "sup", "sub"]);
const SOFT_404 = /\b(page (you requested )?(was )?not found|404 not found|page does not exist|page cannot be found)\b/i;

// Menus that aren't in <nav> show up as long runs of short, label-like lines. Drop those runs.
function dropMenuRuns(lines: string[]) {
  const isLabel = (l: string) => l.split(/\s+/).length <= 4 && !/[\d.:;,!?]/.test(l);
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length < 6) out.push(...run);
    run = [];
  };
  for (const l of lines) {
    if (isLabel(l)) run.push(l);
    else {
      flush();
      out.push(l);
    }
  }
  flush();
  return out;
}

export function chunkSections(sections: { heading: string; text: string }[], sourceId: string, destinationId: string) {
  const chunks: Chunk[] = [];
  for (const s of sections) {
    const lines = dropMenuRuns(s.text.split("\n").filter(Boolean));
    let buf = "";
    const flush = () => {
      if (buf.trim().length > 40) {
        chunks.push({ id: `${sourceId}#${chunks.length}`, sourceId, destinationId, heading: s.heading, text: buf.trim() });
      }
      buf = "";
    };
    for (const line of lines) {
      if (buf.length + line.length > CHUNK_CHARS) flush();
      buf += line + "\n";
    }
    flush();
  }
  return chunks;
}

// Manual fallback for pages that block automated fetching: paste the page text into
// data/manual/<source-id>.md with a first line "captured: YYYY-MM-DD".
function readManual(sourceId: string): { text: string; captured: string } | null {
  const p = path.join(process.cwd(), "data", "manual", `${sourceId}.md`);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  const m = raw.match(/^captured:\s*(\d{4}-\d{2}-\d{2})\s*\n/);
  if (!m) return null;
  return { captured: m[1], text: raw.slice(m[0].length) };
}

async function fetchSource(url: string): Promise<FetchResult> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en" },
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
    });
    if (res.status === 404 || res.status === 410) return { ok: false, gone: true, error: `HTTP ${res.status}` };
    if (!res.ok) return { ok: false, gone: false, error: `HTTP ${res.status} (blocked or unavailable)` };
    const html = await res.text();
    const sections = htmlToSections(html);
    const chars = sections.reduce((n, s) => n + s.text.length, 0);
    const head = sections.map((s) => s.heading + " " + s.text).join(" ").slice(0, 4000);
    if (SOFT_404.test(head)) return { ok: false, gone: true, error: "Page not found (the page has moved or been removed)" };
    if (chars < MIN_TEXT_CHARS) return { ok: false, gone: false, error: "Page content not readable (likely rendered by JavaScript)" };
    return { ok: true, sections };
  } catch (e) {
    return { ok: false, gone: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Page furniture that changes on every visit (view counters, "last updated" stamps) must not
// count as a rule change, or answers would show "Updated recently" for nothing.
const VOLATILE = [
  /^\|?\s*[\d,]+\s+(views?|visitors?|hits)\b.*$/gim,
  /^.*(page views|visitor count|number of visitors|จำนวนผู้เยี่ยมชม).*$/gim,
  /^.*(last (updated|modified|reviewed)|วันที่ปรับปรุงข้อมูล).*$/gim,
  /^.*(people found this (page |content )?(useful|helpful)|was this (page|information|content) (useful|helpful)).*$/gim,
  /^\s*yes\s*no\s*$/gim,
];

export function stableText(text: string) {
  // Case-only differences aren't rule changes either.
  return VOLATILE.reduce((t, re) => t.replace(re, ""), text).replace(/\n{2,}/g, "\n").toLowerCase();
}

function hashSections(sections: { heading: string; text: string }[]) {
  const body = sections.map((s) => s.heading + "\n" + s.text).join("\n");
  return crypto.createHash("sha256").update(stableText(body)).digest("hex");
}

export async function runRecheck(opts: { log?: (s: string) => void; save?: boolean } = {}) {
  const log = opts.log ?? (() => {});
  const c = db();
  // In production the previous state comes from Supabase; locally from data/store.json.
  const store: Store = structuredClone(c ? await loadStoreFromDb(c) : loadStore());
  const logStart = store.changeLog.length;
  const rechunked = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);
  const summary = { checked: 0, changed: 0, unchanged: 0, failed: 0 };

  // Fetch all pages in parallel so the job fits in a serverless time limit.
  const defs = allSources();
  const results = await Promise.all(defs.map((d) => fetchSource(d.url)));

  for (const [i, def] of defs.entries()) {
    summary.checked++;
    const prev = store.sources[def.id];
    const rec = prev ?? {
      ...def, status: "unavailable" as const, method: null, contentHash: null,
      lastVerified: null, lastAttempt: null, lastError: null,
    };
    Object.assign(rec, { url: def.url, title: def.title, authority: def.authority, destinationId: def.destinationId });
    rec.lastAttempt = today;

    const fetched = results[i];
    let sections: { heading: string; text: string }[] | null = null;
    let method: "fetched" | "manual" | null = null;
    let verifiedOn = today;

    if (fetched.ok) {
      sections = fetched.sections;
      method = "fetched";
    } else {
      const manual = readManual(def.id);
      if (manual) {
        sections = [{ heading: def.title, text: manual.text }];
        method = "manual";
        verifiedOn = manual.captured;
      }
    }

    if (sections) {
      let hash = hashSections(sections);
      // Some servers occasionally serve a slightly different variant. Only treat text as changed
      // when a second fetch returns the same new text.
      if (method === "fetched" && rec.contentHash && hash !== rec.contentHash) {
        const again = await fetchSource(def.url);
        if (!again.ok || hashSections(again.sections) !== hash) hash = rec.contentHash;
      }
      const wasUsable = rec.lastVerified !== null && rec.status !== "removed" && rec.status !== "unavailable";
      if (hash !== rec.contentHash) {
        store.chunks = store.chunks.filter((ch) => ch.sourceId !== def.id).concat(chunkSections(sections, def.id, def.destinationId));
        rechunked.add(def.id);
        store.changeLog.push({ sourceId: def.id, date: today, kind: rec.contentHash ? "changed" : "initial" });
        rec.contentHash = hash;
        summary.changed++;
      } else {
        // Text unchanged: only the date moves forward.
        if (!wasUsable) store.changeLog.push({ sourceId: def.id, date: today, kind: "recovered" });
        summary.unchanged++;
      }
      rec.status = "ok";
      rec.method = method;
      rec.lastVerified = verifiedOn;
      rec.lastError = null;
      log(`✓ ${def.id} (${method})`);
    } else if (!fetched.ok) {
      summary.failed++;
      // Sites that block bots sometimes answer "not found". Only drop a page after it has been
      // reported gone on two checks in a row; a single 404 counts as a failed check.
      const goneBefore = rec.status === "removed" || /^gone:/.test(rec.lastError ?? "");
      rec.lastError = fetched.gone ? `gone: ${fetched.error}` : fetched.error;
      if (fetched.gone && goneBefore) {
        rec.status = "removed";
        store.chunks = store.chunks.filter((ch) => ch.sourceId !== def.id);
        rechunked.add(def.id);
        store.changeLog.push({ sourceId: def.id, date: today, kind: "removed", note: fetched.error });
      } else {
        rec.status = rec.lastVerified ? "check_failed" : "unavailable";
        store.changeLog.push({ sourceId: def.id, date: today, kind: "fetch_failed", note: fetched.gone ? `${fetched.error} (removed if still missing next check)` : fetched.error });
      }
      log(`✗ ${def.id}: ${fetched.error}`);
    }
    store.sources[def.id] = rec;
  }

  store.updatedAt = today;
  if (opts.save !== false) {
    if (c) {
      await saveRecheckToDb(c, store, rechunked, store.changeLog.slice(logStart));
      forgetStoreCache();
      // Official text changed: cached answers may be out of date.
      if (rechunked.size) await clearAnswerCache();
    } else {
      saveStore(store);
    }
  }
  return { summary, store };
}
