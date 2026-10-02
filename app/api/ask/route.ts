import { NextResponse } from "next/server";
import { answerQuestion, type Turn } from "@/lib/answer";
import { findDestinations, findUncovered } from "@/lib/router";
import { detectLang, topicOf } from "@/lib/language";
import { logQuestion } from "@/lib/persist";
import { allow } from "@/lib/ratelimit";
import { signSpeech, voiceConfigured } from "@/lib/voice";

export const runtime = "nodejs";
// Live web search can take 10–20 seconds.
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { question?: unknown; history?: unknown; deviceId?: unknown; web?: unknown } | null;
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
  if (!(await allow(`${ip}:${device}`))) {
    return NextResponse.json(
      { error: "You're asking faster than Didi can keep up! Please wait a few minutes and try again." },
      { status: 429 },
    );
  }

  try {
    const started = Date.now();
    // web: true when the person tapped "Search the web for more" on a previous answer.
    const answer = await answerQuestion(question, history, { web: body?.web === true });
    // Lets /api/speak read this exact answer in Didi's own voice (and nothing else).
    const speakToken = voiceConfigured() ? signSpeech(answer.shortAnswer) : undefined;
    const ms = Date.now() - started;
    // What was asked about and how it ended (no question text), to see what to add next.
    await logQuestion({
      lang: detectLang(question),
      // Covered destinations by id; otherwise an uncovered country people asked about (what to add next).
      destinations: findDestinations(question).map((d) => d.id).concat(findDestinations(question).length ? [] : [findUncovered(question) ?? []].flat().map((c) => `uncovered:${c}`)),
      topic: topicOf(question),
      kind: answer.kind,
      mode: answer.mode,
      ms,
    });
    return NextResponse.json({ answer: { ...answer, speakToken }, ms });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Something went wrong on my side. Please try again in a moment." }, { status: 500 });
  }
}
