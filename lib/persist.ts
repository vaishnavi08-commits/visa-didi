// State that must survive restarts and be shared across server instances: the answer cache,
// the monthly spend counter, per-device rate limits and the question log.
// Stored in Supabase when configured; otherwise kept in memory (fine for local development).
import crypto from "node:crypto";
import { db } from "./db";

const DAY_MS = 86_400_000;
// Answers are kept for a week (official pages are re-checked weekly; the cache is cleared when they change).
const CACHE_MS = 7 * DAY_MS;
const month = () => new Date().toISOString().slice(0, 7);
const day = () => new Date().toISOString().slice(0, 10);
const hashKey = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

// ---------- Answer cache (7 days) ----------

const memCache = new Map<string, { at: number; value: unknown }>();

export async function cacheGet<T>(key: string): Promise<T | null> {
  const k = hashKey(key);
  const c = db();
  if (!c) {
    const hit = memCache.get(k);
    return hit && Date.now() - hit.at < CACHE_MS ? (hit.value as T) : null;
  }
  const { data, error } = await c
    .from("vd_answer_cache")
    .select("answer")
    .eq("key", k)
    .gt("created_at", new Date(Date.now() - CACHE_MS).toISOString())
    .maybeSingle();
  if (error) console.error("cache read", error.message);
  return (data?.answer as T) ?? null;
}

export async function cacheSet(key: string, value: unknown) {
  const k = hashKey(key);
  const c = db();
  if (!c) {
    memCache.set(k, { at: Date.now(), value });
    return;
  }
  const { error } = await c.from("vd_answer_cache").upsert({ key: k, answer: value, created_at: new Date().toISOString() });
  if (error) console.error("cache write", error.message);
}

// ---------- Spend (USD), per day and per month ----------
// vd_spend rows are keyed by period: "2026-10" for the month, "2026-10-02" for the day.

const memSpend = new Map<string, number>();

export async function spent(): Promise<{ today: number; month: number }> {
  const c = db();
  if (!c) return { today: memSpend.get(day()) ?? 0, month: memSpend.get(month()) ?? 0 };
  const { data, error } = await c.from("vd_spend").select("month, usd").in("month", [day(), month()]);
  if (error) console.error("spend read", error.message);
  const get = (k: string) => Number(data?.find((r) => r.month === k)?.usd ?? 0);
  return { today: get(day()), month: get(month()) };
}

export async function addSpend(usd: number) {
  if (!usd) return;
  const c = db();
  if (!c) {
    for (const k of [day(), month()]) memSpend.set(k, (memSpend.get(k) ?? 0) + usd);
    return;
  }
  const results = await Promise.all([day(), month()].map((k) => c.rpc("vd_add_spend", { p_month: k, p_usd: usd })));
  for (const { error } of results) if (error) console.error("spend write", error.message);
}

export async function clearAnswerCache() {
  memCache.clear();
  const c = db();
  if (!c) return;
  const { error } = await c.from("vd_answer_cache").delete().neq("key", "");
  if (error) console.error("cache clear", error.message);
}

// ---------- Rate limit ----------

const memHits = new Map<string, number[]>();

export async function allowRequest(bucket: string, windowSeconds: number, max: number): Promise<boolean> {
  const c = db();
  if (c) {
    const { data, error } = await c.rpc("vd_allow", { p_bucket: bucket, p_window_seconds: windowSeconds, p_max: max });
    if (!error) return data === true;
    console.error("rate limit", error.message);
  }
  const now = Date.now();
  const recent = (memHits.get(bucket) ?? []).filter((t) => now - t < windowSeconds * 1000);
  const ok = recent.length < max;
  if (ok) recent.push(now);
  memHits.set(bucket, recent);
  return ok;
}

// ---------- Question log (no question text, for privacy) ----------

export async function logQuestion(row: { lang: string; destinations: string[]; topic: string | null; kind: string; mode: string; ms: number }) {
  const c = db();
  if (!c) return;
  const { error } = await c.from("vd_question_log").insert(row);
  if (error) console.error("question log", error.message);
}
