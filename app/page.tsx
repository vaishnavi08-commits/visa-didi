"use client";

import { useEffect, useRef, useState } from "react";
import type { Answer, Turn } from "@/lib/answer";
import { DESTINATIONS } from "@/lib/destinations";
import { speakable } from "@/lib/speech";
import { STRINGS, type Strings, type UiLang } from "./strings";

type Item =
  | { role: "user"; text: string }
  // question/history are kept so "Search the web for more" can re-ask with a web search.
  | { role: "assistant"; answer: Answer; question: string; history: Turn[]; searching?: boolean }
  | { role: "error"; text: string };

// ---------- Browser speech (free, built in) ----------

// Didi should sound like an Indian woman. Voice names differ by device:
// Apple: Tara, Veena, Isha, Lekha (Hindi) · Windows/Edge: Neerja, Heera, Kalpana, Swara · Chrome: "Google हिन्दी".
const INDIAN_FEMALE = ["tara", "veena", "isha", "neerja", "heera", "kavya", "aarohi", "ananya", "lekha", "kalpana", "swara", "google हिन्दी"];
const INDIAN_MALE = ["aman", "rishi", "prabhat", "ravi", "hemant", "madhur", "arjun", "kunal"];
const OTHER_FEMALE = ["female", "samantha", "karen", "moira", "tessa", "serena", "victoria", "zira", "fiona", "susan", "aria", "jenny", "libby", "sonia"];

function pickDidiVoice(text: string): SpeechSynthesisVoice | undefined {
  const all = window.speechSynthesis.getVoices();
  const lang = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-");
  const named = (v: SpeechSynthesisVoice, names: string[]) => names.some((n) => v.name.toLowerCase().includes(n));
  const isMale = (v: SpeechSynthesisVoice) => named(v, INDIAN_MALE) || /\bmale\b/i.test(v.name);
  // Answers in Devanagari need a Hindi voice.
  if (/[\u0900-\u097F]/.test(text)) {
    const hindi = all.find((v) => lang(v) === "hi-in" && named(v, INDIAN_FEMALE)) ?? all.find((v) => lang(v) === "hi-in" && !isMale(v));
    if (hindi) return hindi;
  }
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

function savedUiLang(): UiLang {
  try {
    return localStorage.getItem("visa-didi-lang") === "hi" ? "hi" : "en";
  } catch {
    return "en";
  }
}

export default function Home() {
  const [uiLang, setUiLang] = useState<UiLang>("en");
  const t = STRINGS[uiLang];
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [voiceLoadingIdx, setVoiceLoadingIdx] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setUiLang(savedUiLang());
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
    document.documentElement.lang = uiLang;
    try {
      localStorage.setItem("visa-didi-lang", uiLang);
    } catch {}
  }, [uiLang]);

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
      it.role === "user"
        ? [{ role: "user", text: it.text }]
        : it.role === "assistant"
          ? [{ role: "assistant", text: it.answer.shortAnswer, kind: it.answer.kind }]
          : [],
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
      if (data.answer) setItems((prev) => [...prev, { role: "assistant", answer: data.answer!, question: q, history }]);
      else setItems((prev) => [...prev, { role: "error", text: data.error ?? t.genericError }]);
    } catch {
      setItems((prev) => [...prev, { role: "error", text: t.offline }]);
    } finally {
      setLoading(false);
    }
  }

  // Re-asks the same question with a web search and updates that answer card in place.
  async function searchWeb(idx: number) {
    const item = items[idx];
    if (item?.role !== "assistant" || item.searching) return;
    setItems((prev) => prev.map((it, i) => (i === idx && it.role === "assistant" ? { ...it, searching: true } : it)));
    let answer: Answer | null = null;
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: item.question, history: item.history, deviceId: deviceId(), web: true }),
      });
      answer = ((await res.json()) as { answer?: Answer }).answer ?? null;
    } catch {}
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx && it.role === "assistant"
          ? { ...it, searching: false, answer: answer ?? { ...it.answer, canSearchWeb: false, webSearched: true } }
          : it,
      ),
    );
  }

  function toggleMic() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = getRecognition();
    if (!rec) return;
    // The mic listens in the page language: Hindi questions come back in Devanagari.
    rec.lang = uiLang === "hi" ? "hi-IN" : "en-IN";
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
      if (e.error === "not-allowed") setItems((prev) => [...prev, { role: "error", text: t.micBlocked }]);
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  function stopSpeaking() {
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
    setSpeakingIdx(null);
    setVoiceLoadingIdx(null);
  }

  // Browser's built-in voice (fallback when Didi's own voice isn't set up or fails).
  function speakWithBrowser(idx: number, answer: Answer) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(speakable(answer.shortAnswer));
    const voice = pickDidiVoice(answer.shortAnswer);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? (answer.lang === "hi" ? "hi-IN" : "en-IN");
    u.rate = 0.95;
    u.onend = () => setSpeakingIdx((cur) => (cur === idx ? null : cur));
    setSpeakingIdx(idx);
    synth.speak(u);
  }

  async function speak(idx: number, answer: Answer) {
    const wasThis = speakingIdx === idx || voiceLoadingIdx === idx;
    stopSpeaking();
    if (wasThis) return;
    if (!answer.speakToken) return speakWithBrowser(idx, answer);

    // Didi's own (cloned) voice, generated on the server.
    setVoiceLoadingIdx(idx);
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: answer.shortAnswer, token: answer.speakToken, deviceId: deviceId() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setSpeakingIdx((cur) => (cur === idx ? null : cur));
      };
      audioRef.current = audio;
      setVoiceLoadingIdx(null);
      setSpeakingIdx(idx);
      await audio.play();
    } catch {
      setVoiceLoadingIdx(null);
      speakWithBrowser(idx, answer);
    }
  }

  function reset() {
    stopSpeaking();
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
          <span className="tag">{t.tag}</span>
          <div className="top-actions">
            <button
              className="lang-toggle"
              onClick={() => setUiLang(uiLang === "en" ? "hi" : "en")}
              aria-label={t.langSwitch}
              title={t.langSwitch}
            >
              <span className={uiLang === "en" ? "on" : ""}>EN</span>
              <span className={uiLang === "hi" ? "on" : ""} lang="hi">हिं</span>
            </button>
            {items.length > 0 && (
              <button className="new-chat" onClick={reset}>{t.newChat}</button>
            )}
          </div>
        </div>
      </header>

      <main className="thread">
        {items.length === 0 && (
          <section className="hero">
            <h1>{t.heroTitle[0]}<em>{t.heroTitle[1]}</em>{t.heroTitle[2]}</h1>
            <p>{t.heroBody}</p>
            <div className="examples">
              {t.examples.map((e) => (
                <button key={e} className="example" onClick={() => ask(e)}>{e}</button>
              ))}
            </div>
            <p className="coverage-title">{t.coverage}</p>
            <div className="pills">
              {DESTINATIONS.map((d) => (
                <button key={d.id} className="pill" onClick={() => ask(t.pillQuestion(uiLang === "hi" ? d.nameHi : d.name))}>
                  {uiLang === "hi" ? d.nameHi : d.name}
                </button>
              ))}
            </div>
          </section>
        )}

        {items.map((it, i) =>
          it.role === "user" ? (
            <div key={i} className="msg-user"><div className="bubble">{it.text}</div></div>
          ) : it.role === "error" ? (
            <div key={i} className="error" role="alert">{it.text}</div>
          ) : (
            <AnswerCard
              key={i}
              t={t}
              uiLang={uiLang}
              answer={it.answer}
              speaking={speakingIdx === i}
              voiceLoading={voiceLoadingIdx === i}
              onSpeak={() => speak(i, it.answer)}
              searching={!!it.searching}
              onSearchWeb={() => searchWeb(i)}
            />
          ),
        )}

        {loading && (
          <div className="thinking" aria-live="polite">
            <span className="avatar" aria-hidden>D</span>
            <span className="dots" aria-hidden><span /><span /><span /></span>
            <span className="sr-only">{t.checking}</span>
          </div>
        )}
        <div ref={endRef} />
      </main>

      <div className="composer-wrap">
        <form
          className="composer"
          onSubmit={(e) => { e.preventDefault(); ask(input); }}
        >
          <label htmlFor="q" className="sr-only">{t.inputLabel}</label>
          <textarea
            id="q"
            ref={taRef}
            rows={1}
            value={input}
            placeholder={listening ? t.listening : t.placeholder}
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
              aria-label={listening ? t.stopListening : t.askByVoice}
              title={listening ? t.stopListening : t.askByVoice}
              aria-pressed={listening}
              disabled={loading}
            >
              <MicIcon />
            </button>
          )}
          <button type="submit" className="icon-btn send" aria-label={t.send} disabled={loading || !input.trim()}>
            <SendIcon />
          </button>
        </form>
        <p className="composer-foot">{t.foot}</p>
      </div>
    </div>
  );
}

function AnswerCard({
  t, uiLang, answer, speaking, voiceLoading, onSpeak, searching, onSearchWeb,
}: {
  t: Strings; uiLang: UiLang; answer: Answer; speaking: boolean; voiceLoading: boolean; onSpeak: () => void; searching: boolean; onSearchWeb: () => void;
}) {
  const sourceIndex = new Map(answer.sources.map((s, i) => [s.id, i + 1]));
  const stale = answer.sources.filter((s) => s.stale);
  const hasFacts = answer.sources.length > 0;

  return (
    <article className="card">
      <div className="card-head">
        <span className="avatar" aria-hidden>D</span>
        <p className="short" lang={answer.lang === "hi" ? "hi" : "en"}>{answer.shortAnswer}</p>
        <button className={`speak ${voiceLoading ? "loading" : ""}`} onClick={onSpeak} aria-label={speaking || voiceLoading ? t.stopReading : t.readAloud} aria-pressed={speaking} aria-busy={voiceLoading}>
          {speaking || voiceLoading ? <StopIcon /> : <SpeakerIcon />}
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

      {answer.notCovered && <div className="note partial"><strong>{t.notCovered}</strong> {answer.notCovered}</div>}
      {answer.webExtra && (
        <section className="web-extra">
          <p className="web-extra-title">{t.webExtraTitle}</p>
          <p className="web-extra-short">{answer.webExtra.shortAnswer}</p>
          {answer.webExtra.details.length > 0 && (
            <ul className="details">
              {answer.webExtra.details.map((d, i) => (
                <li key={i}>
                  {d.text}
                  {d.sources.length > 0 && (
                    <span className="cite">[{d.sources.map((s) => sourceIndex.get(s)).filter(Boolean).join(", ")}]</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="note web">{t.webExtraNote}</div>
        </section>
      )}
      {answer.conflict && <div className="note conflict"><strong>{t.conflict}</strong> {answer.conflict}</div>}
      {stale.length > 0 && (
        <div className="note stale">{t.stale(stale.length)}</div>
      )}
      {answer.mode === "web" && (
        <div className="note web">{t.webNote}</div>
      )}
      {(answer.canSearchWeb || searching) && (
        <div className="web-offer">
          <button className="web-button" onClick={onSearchWeb} disabled={searching} aria-busy={searching}>
            {searching ? t.searchingWeb : t.searchWeb}
          </button>
          {!searching && <span className="web-offer-hint">{t.searchWebHint}</span>}
        </div>
      )}
      {answer.webSearched && <div className="note mode">{t.webNothing}</div>}
      {answer.mode === "official_text" && (
        <div className="note mode">{answer.fallback ? t.pausedNote : t.demoNote}</div>
      )}

      {hasFacts && (
        <div className="sources">
          <p className="sources-title">{t.sources}</p>
          {answer.sources.map((s, i) => (
            // One compact line per source: number, linked site, official/travel tag, date.
            <div className="source" key={s.id}>
              <span className="cite">{i + 1}.</span>
              <a href={s.url} target="_blank" rel="noopener noreferrer" title={`${s.title} — ${s.authority}`}>{shortTitle(s.title)}</a>
              <span className="site">{siteName(s.url)}</span>
              {s.origin === "web" && (
                <span className={`badge ${s.official ? "ok" : "stale"}`}>{s.official ? t.officialSite : t.travelSite}</span>
              )}
              <span className={`date ${s.stale ? "stale" : ""}`}>
                {s.origin === "web" ? t.found : s.manual ? t.captured : t.lastVerified} {formatDate(s.lastVerified, uiLang)}
              </span>
              {s.recentlyUpdated && <span className="badge new">{t.updatedRecently}</span>}
            </div>
          ))}
        </div>
      )}

      {answer.officialLink && (
        <p className="official-link">
          {t.checkHere} <a href={answer.officialLink.url} target="_blank" rel="noopener noreferrer">{answer.officialLink.label} ↗</a>
        </p>
      )}

      {(answer.verifyLine || hasFacts) && <p className="disclaimer">{t.footnote}</p>}
    </article>
  );
}

// Page titles tell two pages on the same site apart; long ones are shortened to keep each source on one line.
function shortTitle(title: string) {
  const t = title.replace(/\s+/g, " ").trim();
  return t.length > 48 ? t.slice(0, 46).replace(/\s\S*$/, "") + "…" : t;
}

function siteName(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatDate(iso: string, uiLang: UiLang) {
  return new Date(iso + "T00:00:00").toLocaleDateString(uiLang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric" });
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
