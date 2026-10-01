# Visa-didi

A friendly chat that answers visa and entry questions for Indian passport holders, using only official government sources. Every answer shows its source and when it was last verified.

- Covers tourist and business visits to 12 destinations
- English in v1; Hindi and Hinglish planned for v2
- Built with Supabase (pgvector), Vercel and Claude

Status: in development

---


This repo holds the working v1 prototype, built from the *Visa & Entry Rules Assistant — v1 PRD*.

## Run it

```bash
npm install
npm run ingest   # fetch the official pages into data/store.json (the weekly job)
npm run dev      # http://localhost:3000
npm run eval     # guardrail + routing checks
```

Copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY` to get AI-written, cited answers. Without a key the app runs in **official-text mode**: it shows the most relevant passages from the official pages directly, with the same citations, dates and guardrails.

## How it maps to the PRD

| PRD requirement | Where |
|---|---|
| 12 destinations, official sources only | `lib/destinations.ts` |
| Weekly re-check, change detection, change log | `lib/ingest.ts`, `npm run ingest`, `/api/cron/recheck` + `vercel.json` (Mondays 03:00 UTC) |
| Stale warning after 14 days; removed pages dropped | `lib/store.ts` (`isStale`, `isUsable`), shown in the answer card |
| "Updated recently" badge | change log entries in the last 14 days |
| Manual fallback for blocked pages | `data/manual/<source-id>.md` with first line `captured: YYYY-MM-DD` |
| Guardrails: uncovered destination, student/work/residency, other passports, approval predictions, off-topic, missing destination | `lib/router.ts` (deterministic, runs before any model call) |
| Answer format: short answer → details → sources with dates → verify line + fixed disclaimer | `lib/answer.ts`, `app/page.tsx` |
| Never uncited: citations must point at retrieved excerpts, otherwise "not covered" | `toAnswer()` in `lib/answer.ts` |
| **Change from PRD (v2 item brought forward):** Hindi and Hinglish. Didi answers in the language of the question; an EN / हिं toggle switches the page text and the mic language; Hindi answers are read aloud in a Hindi female voice | `lib/language.ts`, `app/strings.ts` |
| **Change from PRD:** when the stored official pages can't answer (e.g. Vietnam, US, Australia), Claude searches the web live. Answers are labelled, each source is tagged "Official site" or "Travel site", and only cited claims are kept | `lib/websearch.ts` |
| One follow-up when destination/purpose is missing | router (destination) + model `clarify` status (purpose) |
| Voice in (mic) and read-aloud in a female voice, only on tap | browser Web Speech API in `app/page.tsx` |
| Rate limit per device, 1-day answer cache, monthly spend cap | `lib/ratelimit.ts`, `lib/answer.ts` (`MONTHLY_BUDGET_USD`) |

**Model:** `claude-opus-5-5` at low effort (for the < 5 s target), JSON-schema structured output, and server-side refusal fallbacks (`fallbacks: "default"`) enabled.

## Source coverage (as of 1 Oct 2026)

Verified official text is stored for **9 of 12** destinations: Thailand, Singapore, Malaysia, Indonesia, Sri Lanka, UAE, Japan, Schengen, UK.
**US, Australia and Vietnam** block automated fetching or render with JavaScript. The app answers those with "I can't confirm this right now" and a link to the official site. To fill them, add a manual capture in `data/manual/`.

With `ANTHROPIC_API_KEY` set, questions about these three (and anything the stored pages don't cover) are answered by live web search instead.

Thin sources worth adding next: the Sri Lanka 40-country ETA list, the Malaysia country list, and a fuller Indonesia visa-on-arrival page.

## Prototype shortcuts (swap before launch)

- **Storage** is `data/store.json`, shaped like the Supabase tables (sources, chunks, change log). On Vercel the filesystem is read-only, so the cron route reports results but can't persist them until it writes to Supabase.
- **Retrieval** is keyword BM25 (`lib/retrieve.ts`). The PRD leaves the embedding model open, so pgvector can replace it behind the same `retrieve()` call.
- **Rate limit and spend counter** are in memory, per server instance.
- **Eval** covers 16 guardrail and routing cases. The full ~40-question test set with expected answers is still to be written from the official pages.
