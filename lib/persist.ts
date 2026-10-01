// State that must survive restarts and be shared across server instances: the answer cache,
// the monthly spend counter, per-device rate limits and the question log.
// Stored in Supabase when configured; otherwise kept in memory (fine for local development).
import crypto from "node:crypto";
import { db } from "./db";

const DAY_MS = 86_400_000;
const month = () => new Date().toISOString().slice(0, 7);
const hashKey = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

// ---------- Answer cache (1 day) ----------

const memCache = new Map<string, { at: number; value: unknown }>();

export async function cacheGet<T>(key: string): Promise<T | null> {
  const k = hashKey(key);
  const c = db();
  if (!c) {
    const hit = memCache.get(k);
    return hit && Date.now() - hit.at < DAY_MS ? (hit.value as T) : null;
  }
  const { data, error } = await c
    .from("vd_answer_cache")
    .select("answer")
    .eq("key", k)
    .gt("created_at", new Date(Date.now() - DAY_MS).toISOString())
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

// ---------- Monthly spend (USD) ----------

const memSpend = { month: "", usd: 0 };

export async function spentThisMonth(): Promise<number> {
  const c = db();
  if (!c) return memSpend.month === month() ? memSpend.usd : 0;
  const { data, error } = await c.from("vd_spend").select("usd").eq("month", month()).maybeSingle();
  if (error) console.error("spend read", error.message);
  return Number(data?.usd ?? 0);
}

export async function addSpend(usd: number) {
  if (!usd) return;
  const c = db();
  if (!c) {
    if (memSpend.month !== month()) Object.assign(memSpend, { month: month(), usd: 0 });
    memSpend.usd += usd;
    return;
  }
  const { error } = await c.rpc("vd_add_spend", { p_month: month(), p_usd: usd });
  if (error) console.error("spend write", error.message);
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
