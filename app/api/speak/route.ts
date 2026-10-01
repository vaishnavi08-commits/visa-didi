import crypto from "node:crypto";
import { MAX_SPOKEN_CHARS, speakable } from "@/lib/speech";
import { allow } from "@/lib/ratelimit";
import { synthesize, verifySpeech, voiceConfigured } from "@/lib/voice";

export const runtime = "nodejs";
export const maxDuration = 30;

// Recent clips, so replaying an answer doesn't cost another generation.
const clips = new Map<string, ArrayBuffer>();
const MAX_CLIPS = 100;

export async function POST(req: Request) {
  if (!voiceConfigured()) return new Response("Voice not configured", { status: 404 });

  const body = (await req.json().catch(() => null)) as { text?: unknown; token?: unknown; deviceId?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  const token = typeof body?.token === "string" ? body.token : "";
  // Only text that Didi itself wrote (signed by the server) may be spoken in the owner's voice.
  if (!text || !token || text.length > MAX_SPOKEN_CHARS * 2 || !verifySpeech(text, token)) {
    return new Response("Not allowed", { status: 403 });
  }

  const spoken = speakable(text).slice(0, MAX_SPOKEN_CHARS);
  const key = crypto.createHash("sha256").update(spoken).digest("hex");
  let audio = clips.get(key);
  if (!audio) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const device = typeof body?.deviceId === "string" ? body.deviceId.slice(0, 64) : "";
    if (!allow(`speak:${ip}:${device}`)) return new Response("Too many requests", { status: 429 });
    try {
      audio = await synthesize(spoken);
    } catch (e) {
      console.error("voice synthesis failed", e);
      return new Response("Voice unavailable", { status: 502 });
    }
    if (clips.size >= MAX_CLIPS) clips.delete(clips.keys().next().value!);
    clips.set(key, audio);
  }
  return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" } });
}
