// Weekly re-check, triggered by Vercel Cron (see vercel.json).
// Vercel's filesystem is read-only at runtime, so this route reports what changed;
// persisting results needs the Supabase store (see README). Locally, use `npm run ingest`.
import { NextResponse } from "next/server";
import { runRecheck } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { summary, store } = await runRecheck({ save: !process.env.VERCEL });
  const failed = Object.values(store.sources)
    .filter((s) => s.status !== "ok")
    .map((s) => ({ id: s.id, status: s.status, error: s.lastError }));
  return NextResponse.json({ summary, failed });
}
