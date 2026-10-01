// Weekly re-check, triggered by Vercel Cron (see vercel.json).
// Results are saved to Supabase. Without it, Vercel's read-only filesystem means results
// can't be kept; locally, `npm run ingest` updates data/store.json instead.
import { NextResponse } from "next/server";
import { runRecheck } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { summary, store } = await runRecheck({ save: !!process.env.SUPABASE_URL || !process.env.VERCEL });
  const failed = Object.values(store.sources)
    .filter((s) => s.status !== "ok")
    .map((s) => ({ id: s.id, status: s.status, error: s.lastError }));
  return NextResponse.json({ summary, failed });
}
