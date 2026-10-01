// Supabase (Postgres) storage. Server only: uses the service role key, which bypasses RLS.
// When SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY aren't set, callers fall back to the local
// JSON file and in-memory state, so local development still works without a database.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ChangeLogEntry, Chunk, SourceRecord, Store } from "./store";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

type SourceRow = {
  id: string; destination_id: string; url: string; title: string; authority: string;
  status: SourceRecord["status"]; method: SourceRecord["method"]; content_hash: string | null;
  last_verified: string | null; last_attempt: string | null; last_error: string | null;
};

const toRecord = (r: SourceRow): SourceRecord => ({
  id: r.id, destinationId: r.destination_id, url: r.url, title: r.title, authority: r.authority,
  status: r.status, method: r.method, contentHash: r.content_hash,
  lastVerified: r.last_verified, lastAttempt: r.last_attempt, lastError: r.last_error,
});

const toRow = (r: SourceRecord): SourceRow => ({
  id: r.id, destination_id: r.destinationId, url: r.url, title: r.title, authority: r.authority,
  status: r.status, method: r.method, content_hash: r.contentHash,
  last_verified: r.lastVerified, last_attempt: r.lastAttempt, last_error: r.lastError,
});

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Supabase ${what}: ${res.error.message}`);
  return res.data as T;
}

export async function loadStoreFromDb(c: SupabaseClient): Promise<Store> {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const [sources, chunks, log] = await Promise.all([
    c.from("vd_sources").select("*"),
    c.from("vd_chunks").select("id, source_id, destination_id, heading, text"),
    c.from("vd_change_log").select("source_id, date, kind, note").gte("date", since).order("id"),
  ]);
  const sourceRows = check(sources, "load sources") as SourceRow[];
  const chunkRows = check(chunks, "load chunks") as { id: string; source_id: string; destination_id: string; heading: string; text: string }[];
  const logRows = check(log, "load change log") as { source_id: string; date: string; kind: ChangeLogEntry["kind"]; note: string | null }[];
  return {
    updatedAt: sourceRows.reduce<string | null>((max, r) => (r.last_attempt && (!max || r.last_attempt > max) ? r.last_attempt : max), null),
    sources: Object.fromEntries(sourceRows.map((r) => [r.id, toRecord(r)])),
    chunks: chunkRows.map((r) => ({ id: r.id, sourceId: r.source_id, destinationId: r.destination_id, heading: r.heading, text: r.text })),
    changeLog: logRows.map((r) => ({ sourceId: r.source_id, date: r.date, kind: r.kind, note: r.note ?? undefined })),
  };
}

// Writes what a re-check changed: every source's status, the chunks of pages whose text changed
// (or disappeared), and the new change-log entries.
export async function saveRecheckToDb(c: SupabaseClient, store: Store, rechunked: Set<string>, newLog: ChangeLogEntry[]) {
  check(await c.from("vd_sources").upsert(Object.values(store.sources).map(toRow)), "save sources");
  for (const sourceId of rechunked) {
    check(await c.from("vd_chunks").delete().eq("source_id", sourceId), "clear chunks");
    const rows = store.chunks
      .filter((ch: Chunk) => ch.sourceId === sourceId)
      .map((ch) => ({ id: ch.id, source_id: ch.sourceId, destination_id: ch.destinationId, heading: ch.heading, text: ch.text }));
    if (rows.length) check(await c.from("vd_chunks").insert(rows), "save chunks");
  }
  if (newLog.length) {
    check(await c.from("vd_change_log").insert(newLog.map((e) => ({ source_id: e.sourceId, date: e.date, kind: e.kind, note: e.note ?? null }))), "save change log");
  }
}
