// Per-device rate limit (there is no login). In-memory: fine for a prototype on one instance;
// move to Supabase or Vercel KV for production.
const WINDOW_MS = 10 * 60_000;
const MAX_REQUESTS = 20;
const hits = new Map<string, number[]>();

export function allow(deviceKey: string) {
  const now = Date.now();
  const recent = (hits.get(deviceKey) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    hits.set(deviceKey, recent);
    return false;
  }
  recent.push(now);
  hits.set(deviceKey, recent);
  return true;
}
