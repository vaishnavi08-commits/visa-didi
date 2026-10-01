"use client";

import { useEffect, useRef, useState } from "react";
import type { Answer, Turn } from "@/lib/answer";
import { DESTINATIONS } from "@/lib/destinations";

const EXAMPLES = [
  "Do I need a visa for Vietnam?",
  "What documents do I need for a UK tourist visa?",
  "Can I attend a conference in Japan on a tourist visa?",
  "How long does a Schengen visa take to process?",
];

type Item =
  | { role: "user"; text: string }
  | { role: "assistant"; answer: Answer }
  | { role: "error"; text: string };

// ---------- Browser speech (free, built in) ----------

// Didi should sound like an Indian woman. Voice names differ by device:
// Apple: Tara, Veena, Isha, Lekha (Hindi) · Windows/Edge: Neerja, Heera, Kalpana, Swara · Chrome: "Google हिन्दी".
const INDIAN_FEMALE = ["tara", "veena", "isha", "neerja", "heera", "kavya", "aarohi", "ananya", "lekha", "kalpana", "swara", "google हिन्दी"];
const INDIAN_MALE = ["aman", "rishi", "prabhat", "ravi", "hemant", "madhur", "arjun", "kunal"];
const OTHER_FEMALE = ["female", "samantha", "karen", "moira", "tessa", "serena", "victoria", "zira", "fiona", "susan", "aria", "jenny", "libby", "sonia"];

function pickDidiVoice(): SpeechSynthesisVoice | undefined {
  const all = window.speechSynthesis.getVoices();
  const lang = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-");
  const named = (v: SpeechSynthesisVoice, names: string[]) => names.some((n) => v.name.toLowerCase().includes(n));
  const isMale = (v: SpeechSynthesisVoice) => named(v, INDIAN_MALE) || /\bmale\b/i.test(v.name);
  return (
    all.find((v) => lang(v) === "en-in" && named(v, INDIAN_FEMALE)) ??
    // A Hindi female voice reads English with an Indian accent.
    all.find((v) => lang(v) === "hi-in" && named(v, INDIAN_FEMALE)) ??
    all.find((v) => lang(v) === "en-in" && !isMale(v)) ??
    all.find((v) => lang(v).startsWith("en") && named(v, OTHER_FEMALE)) ??
    all.find((v) => lang(v).startsWith("en"))
  );
}

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getRecognition(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

function deviceId() {
  try {
    let id = localStorage.getItem("visa-didi-device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("visa-didi-device", id);
    }
    return id;
  } catch {
    return "";
  }
}

// ---------- Page ----------

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMicSupported(!!getRecognition());
    // Voices load asynchronously in some browsers.
    window.speechSynthesis?.getVoices();
  }, []);

  useEffect(() => {
    // A new answer scrolls to its top so the short answer is read first; otherwise follow the end.
    const cards = document.querySelectorAll(".thread .card");
    const last = items[items.length - 1];
    if (!loading && last?.role === "assistant" && cards.length) {
      cards[cards.length - 1].scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [items, loading]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    // Empty box: let rows={1} size it (measuring before fonts/layout settle can overshoot).
    if (input) ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }, [input]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    const history: Turn[] = items.flatMap((it): Turn[] =>
      it.role === "user" ? [{ role: "user", text: it.text }] : it.role === "assistant" ? [{ role: "assistant", text: it.answer.shortAnswer }] : [],
    );
    setItems((prev) => [...prev, { role: "user", text: q }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history, deviceId: deviceId() }),
      });
      const data = (await res.json()) as { answer?: Answer; error?: string };
      if (data.answer) setItems((prev) => [...prev, { role: "assistant", answer: data.answer! }]);
      else setItems((prev) => [...prev, { role: "error", text: data.error ?? "Something went wrong." }]);
    } catch {
      setItems((prev) => [...prev, { role: "error", text: "I couldn't reach the server. Check your connection and try again." }]);
    } finally {
      setLoading(false);
    }
  }

  function toggleMic() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = getRecognition();
    if (!rec) return;
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText = text;
      }
      setInput(text);
    };
    rec.onend = () => {
      setListening(false);
      if (finalText.trim()) ask(finalText);
    };
    rec.onerror = (e) => {
      setListening(false);
      if (e.error === "not-allowed") setItems((prev) => [...prev, { role: "error", text: "Microphone access was blocked. You can allow it in your browser settings, or just type." }]);
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  function speak(idx: number, answer: Answer) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (speakingIdx === idx) {
      synth.cancel();
      setSpeakingIdx(null);
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(answer.shortAnswer);
    const voice = pickDidiVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "en-IN";
    u.rate = 0.95;
    u.onend = () => setSpeakingIdx((cur) => (cur === idx ? null : cur));
    setSpeakingIdx(idx);
    synth.speak(u);
  }

  function reset() {
    window.speechSynthesis?.cancel();
    setSpeakingIdx(null);
    setItems([]);
    setInput("");
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/" onClick={(e) => { e.preventDefault(); reset(); }}>
            <span className="brand-mark" aria-hidden>D</span>
            <span className="brand-name">Visa Didi</span>
          </a>
          <span className="tag">Official sources first · Indian passports</span>
          {items.length > 0 && (
            <button className="new-chat" onClick={reset}>New chat</button>
          )}
        </div>
      </header>

      <main className="thread">
        {items.length === 0 && (
          <section className="hero">
            <h1>Namaste! Ask Didi about <em>visas</em>.</h1>
            <p>
              Straight answers for Indian passport holders on tourist and short business trips. Official government pages
              come first; when they don&apos;t cover something, Didi searches the web and tells you so. Every answer shows its sources.
            </p>
            <div className="examples">
              {EXAMPLES.map((e) => (
                <button key={e} className="example" onClick={() => ask(e)}>{e}</button>
              ))}
            </div>
            <p className="coverage-title">Destinations I cover</p>
            <div className="pills">
              {DESTINATIONS.map((d) => <span key={d.id} className="pill">{d.name}</span>)}
            </div>
          </section>
        )}

        {items.map((it, i) =>
          it.role === "user" ? (
            <div key={i} className="msg-user"><div className="bubble">{it.text}</div></div>
          ) : it.role === "error" ? (
            <div key={i} className="error" role="alert">{it.text}</div>
          ) : (
            <AnswerCard key={i} answer={it.answer} speaking={speakingIdx === i} onSpeak={() => speak(i, it.answer)} />
          ),
        )}

        {loading && (
          <div className="thinking" aria-live="polite">
            <span className="avatar" aria-hidden>D</span>
            <span className="dots" aria-hidden><span /><span /><span /></span>
            <span className="sr-only">Checking the official sources…</span>
          </div>
        )}
        <div ref={endRef} />
      </main>

      <div className="composer-wrap">
        <form
          className="composer"
          onSubmit={(e) => { e.preventDefault(); ask(input); }}
        >
          <label htmlFor="q" className="sr-only">Ask a visa or entry question</label>
          <textarea
            id="q"
            ref={taRef}
            rows={1}
            value={input}
            placeholder={listening ? "Listening…" : "Ask a visa or entry question…"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); }
            }}
          />
          {micSupported && (
            <button
              type="button"
              className={`icon-btn ${listening ? "listening" : ""}`}
              onClick={toggleMic}
              aria-label={listening ? "Stop listening" : "Ask by voice"}
              aria-pressed={listening}
              disabled={loading}
            >
              <MicIcon />
            </button>
          )}
          <button type="submit" className="icon-btn send" aria-label="Send" disabled={loading || !input.trim()}>
            <SendIcon />
          </button>
        </form>
        <p className="composer-foot">Not legal or immigration advice. Always confirm on the official site before you book.</p>
      </div>
    </div>
  );
}

function AnswerCard({ answer, speaking, onSpeak }: { answer: Answer; speaking: boolean; onSpeak: () => void }) {
  const sourceIndex = new Map(answer.sources.map((s, i) => [s.id, i + 1]));
  const stale = answer.sources.filter((s) => s.stale);
  const hasFacts = answer.sources.length > 0;

  return (
    <article className="card">
      <div className="card-head">
        <span className="avatar" aria-hidden>D</span>
        <p className="short">{answer.shortAnswer}</p>
        <button className="speak" onClick={onSpeak} aria-label={speaking ? "Stop reading aloud" : "Read answer aloud"} aria-pressed={speaking}>
          {speaking ? <StopIcon /> : <SpeakerIcon />}
        </button>
      </div>

      {answer.details.length > 0 && (
        <ul className="details">
          {answer.details.map((d, i) => (
            <li key={i}>
              {d.text}
              {d.sources.length > 0 && (
                <span className="cite">[{d.sources.map((s) => sourceIndex.get(s)).filter(Boolean).join(", ")}]</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {answer.notCovered && <div className="note partial"><strong>Not covered by the official pages I have:</strong> {answer.notCovered}</div>}
      {answer.conflict && <div className="note conflict"><strong>Official sources disagree:</strong> {answer.conflict}</div>}
      {stale.length > 0 && (
        <div className="note stale">
          I couldn&apos;t re-check {stale.length === 1 ? "this source" : "some of these sources"} in the last 14 days. Please verify on the official site.
        </div>
      )}
      {answer.mode === "web" && (
        <div className="note web">
          I didn&apos;t have this in my stored official pages, so I searched the web. Sources marked &ldquo;Travel site&rdquo;
          aren&apos;t official — please confirm on the official site.
        </div>
      )}
      {answer.mode === "official_text" && (
        <div className="note mode">Demo mode: AI summaries are off, so I&apos;m showing the official text directly.</div>
      )}

      {hasFacts && (
        <div className="sources">
          <p className="sources-title">Sources</p>
          {answer.sources.map((s, i) => (
            <div className="source" key={s.id}>
              <span className="cite">{i + 1}.</span>
              <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
              <span className="auth">{s.authority}</span>
              {s.origin === "web" ? (
                <>
                  <span className={`badge ${s.official ? "ok" : "stale"}`}>{s.official ? "Official site" : "Travel site"}</span>
                  <span className="badge muted">Found {formatDate(s.lastVerified)}</span>
                </>
              ) : (
                <span className={`badge ${s.stale ? "stale" : "ok"}`}>
                  {s.manual ? "Captured" : "Last verified"} {formatDate(s.lastVerified)}
                </span>
              )}
              {s.recentlyUpdated && <span className="badge new">Updated recently</span>}
            </div>
          ))}
        </div>
      )}

      {answer.officialLink && (
        <p className="official-link">
          Check here: <a href={answer.officialLink.url} target="_blank" rel="noopener noreferrer">{answer.officialLink.label} ↗</a>
        </p>
      )}

      {answer.verifyLine && <p className="verify">Rules can change — please confirm on the official site before you book or apply.</p>}
      {hasFacts && (
        <p className="disclaimer">
          {answer.mode === "web" ? "Information found on the web" : "Information from official sources"}, not legal or immigration advice. Rules can change.
        </p>
      )}
    </article>
  );
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
  </svg>
);
const SendIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
const SpeakerIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
  </svg>
);
const StopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
);
