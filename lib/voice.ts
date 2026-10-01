// Didi's own voice via ElevenLabs (a cloned voice). Server only: the API key never reaches the browser.
//
// The voice is the owner's, so the speak endpoint must not say arbitrary text. Every answer the server
// writes carries an HMAC signature, and /api/speak only voices text with a valid signature.
import crypto from "node:crypto";

export function voiceConfigured() {
  return !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);
}

function signingKey() {
  return process.env.VOICE_SIGNING_SECRET || process.env.ELEVENLABS_API_KEY || "";
}

export function signSpeech(text: string) {
  return crypto.createHmac("sha256", signingKey()).update(text).digest("base64url");
}

export function verifySpeech(text: string, token: string) {
  const expected = Buffer.from(signSpeech(text));
  const given = Buffer.from(token);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export async function synthesize(text: string): Promise<ArrayBuffer> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID!;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY!, Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      // Multilingual model: the same cloned voice speaks English, Hindi and Hinglish.
      model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.85 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.arrayBuffer();
}
