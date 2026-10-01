// Official-page storage: Supabase tables (vd_sources, vd_chunks, vd_change_log) in production,
// or one local JSON file of the same shape when Supabase isn't configured.
import fs from "node:fs";
import path from "node:path";
import { db, loadStoreFromDb } from "./db";

export const STALE_AFTER_DAYS = 14;
export const RECENT_CHANGE_DAYS = 14;

export type SourceStatus =
  | "ok" // last check succeeded
  | "check_failed" // last check failed; serving previously verified text
  | "unavailable" // never verified (blocked / unreadable); not used in answers
  | "removed"; // page is gone (404/410); not used in answers until replaced

export type SourceRecord = {
  id: string;
  destinationId: string;
  url: string;
  title: string;
  authority: string;
  status: SourceStatus;
  method: "fetched" | "manual" | null;
  contentHash: string | null;
  lastVerified: string | null; // ISO date of the last successful check
  lastAttempt: string | null;
  lastError: string | null;
};

export type Chunk = {
  id: string;
  sourceId: string;
  destinationId: string;
  heading: string;
  text: string;
};

export type ChangeLogEntry = {
  sourceId: string;
  date: string;
  kind: "initial" | "changed" | "fetch_failed" | "removed" | "recovered";
  note?: string;
};

export type Store = {
  updatedAt: string | null;
  sources: Record<string, SourceRecord>;
  chunks: Chunk[];
  changeLog: ChangeLogEntry[];
};

export const STORE_PATH = path.join(process.cwd(), "data", "store.json");

let cache: { mtimeMs: number; store: Store } | null = null;

export function loadStore(): Store {
  try {
    const stat = fs.statSync(STORE_PATH);
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.store;
    const store = JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as Store;
    cache = { mtimeMs: stat.mtimeMs, store };
    return store;
  } catch {
    return { updatedAt: null, sources: {}, chunks: [], changeLog: [] };
  }
}

// The store the app answers from. Database reads are reused for a few minutes per server instance.
let dbCache: { at: number; store: Store } | null = null;
const DB_CACHE_MS = 5 * 60_000;

export async function getStore(): Promise<Store> {
  const c = db();
  if (!c) return loadStore();
  if (dbCache && Date.now() - dbCache.at < DB_CACHE_MS) return dbCache.store;
  try {
    const store = await loadStoreFromDb(c);
    // An empty database (not seeded yet) falls back to the bundled file.
    if (!store.chunks.length) return loadStore();
    dbCache = { at: Date.now(), store };
    return store;
  } catch (e) {
    console.error(e);
    return dbCache?.store ?? loadStore();
  }
}

export function forgetStoreCache() {
  dbCache = null;
}

export function saveStore(store: Store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 1));
  cache = null;
}

export function daysSince(isoDate: string | null, now = new Date()) {
  if (!isoDate) return Infinity;
  return (now.getTime() - new Date(isoDate).getTime()) / 86_400_000;
}

// A source can back an answer only if it has verified text and hasn't disappeared.
export function isUsable(s: SourceRecord) {
  return (s.status === "ok" || s.status === "check_failed") && s.lastVerified !== null;
}

export function isStale(s: SourceRecord) {
  return daysSince(s.lastVerified) > STALE_AFTER_DAYS;
}

export function recentlyUpdated(store: Store, sourceId: string) {
  return store.changeLog.some(
    (e) => e.sourceId === sourceId && e.kind === "changed" && daysSince(e.date) <= RECENT_CHANGE_DAYS,
  );
}
