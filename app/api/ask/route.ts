import { NextResponse } from "next/server";
import { answerQuestion, type Turn } from "@/lib/answer";
import { allow } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { question?: unknown; history?: unknown; deviceId?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 500) : "";
  if (!question) return NextResponse.json({ error: "Please type a question." }, { status: 400 });

  const history: Turn[] = Array.isArray(body?.history)
    ? body.history
        .filter((t): t is Turn => !!t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
        .slice(-6)
        .map((t) => ({ role: t.role, text: t.text.slice(0, 1000) }))
    : [];

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const device = typeof body?.deviceId === "string" ? body.deviceId.slice(0, 64) : "";
  if (!allow(`${ip}:${device}`)) {
    return NextResponse.json(
      { error: "You're asking faster than Didi can keep up! Please wait a few minutes and try again." },
      { status: 429 },
    );
  }

  try {
    const started = Date.now();
    const answer = await answerQuestion(question, history);
    return NextResponse.json({ answer, ms: Date.now() - started });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Something went wrong on my side. Please try again in a moment." }, { status: 500 });
  }
}
