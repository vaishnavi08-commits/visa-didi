# Visa Didi — v1.1 changes to the PRD

Oct 2, 2026 · companion to *Visa & Entry Rules Assistant — v1 PRD* (Sep 30, 2026)

The v1 PRD still describes the product. This page records what changed while building and testing it,
why, and what the live product does today at [visa-didi.vercel.app](https://visa-didi.vercel.app).

## Summary of decisions

| Area | v1 PRD | Now (v1.1) | Why |
|---|---|---|---|
| Sources | Official government sources only | Official pages first; **web search on request** when they don't cover a question | Vietnam and Australia have no readable official page (their sites block automated fetching or render only with JavaScript), and several others only partly answer common questions, so "official only" often meant "can't confirm" |
| Trust labelling | Every answer cites official pages | Unchanged for official answers; web answers say "Found on the web", tag each source **Official site** or **Travel site**, and keep only facts tied to a page the search returned | Keeps the core trust promise visible even when web sources are used |
| Languages | English only; Hindi and Hinglish in v2 | **English, Hindi and Hinglish in v1**, auto-detected from the question; EN / हिं toggle for page text and mic | Brought forward: most Indian users type Hinglish |
| Voice | Mic + female read-aloud via browser | Unchanged; prefers Indian female voices (e.g. Tara, Lekha, Neerja), never reads emoji | Default browser voices sounded American |
| Model | "An LLM API, such as Claude" | **Claude Sonnet 5.5** (configurable) | Haiku 4.5 was cheaper but misread nuanced rules in testing (Japan short-term stay); Opus 5.5 was most careful but 2× the cost |
| Follow-up questions | Ask one short follow-up when destination/purpose is missing | Unchanged, now enforced: a reply completes the original question and Didi never asks twice | Early build looped on the same follow-up |
| Small talk | Not specified | Greetings and thanks get a friendly reply, never a search | "Hi Visa Didi" triggered a full answer |
| Answer length | Short answer → key details → sources → verify line | Same order, tighter: ≤ 2 short sentences, ≤ 3 one-line details, one compact line per source, one footnote | Answers read long on phones |
| Storage | Supabase with pgvector | Supabase (tables prefixed `vd_`, RLS on, server-only access); keyword (BM25) search for now; `embedding` column ready for pgvector | The embedding model is still undecided; keyword search met the accuracy targets |
| Cost controls | Rate limit per device, 1-day cache, monthly cap | Per-device rate limit; **7-day** cache cleared when official pages change; **daily ($0.50) and monthly ($5) caps**; web search only when tapped | Real spend during testing was higher than expected |

## Sources and freshness

- 26 official sources across 12 destinations: 17 with stored text, covering 10 destinations (none yet for Vietnam and Australia) (e.g. GOV.UK, European Commission,
  ICA Singapore, Royal Thai Embassy New Delhi, US Embassy India, Japan MOFA including *Validity of a Visa* and the exemption list).
- Weekly re-check (Vercel Cron, Mondays 03:00 UTC) saves to Supabase, logs changes, and clears cached answers when text changes.
- Japan's sites block Vercel's servers: their pages were fetched locally and stored with their real dates. If the weekly
  check keeps failing, answers show the PRD's "couldn't re-check in 14 days" warning.
- **New rule:** a page is only removed after two checks in a row report it missing. Bot-blocking sites sometimes answer
  "not found" for pages that exist; one 404 previously would have deleted Japan's fee page.
- Manual fallback (PRD risk mitigation) is implemented: `data/manual/<source-id>.md` with a capture date.

## Guardrails (unchanged in intent)

Refuses uncovered destinations, student/work/residency visas, non-Indian passports and approval predictions — in all three
languages — before any model call. Uncovered destinations people ask about are logged (`uncovered:<country>`) to show what to add next.

## Evaluation

- `npm run eval`: 29 free guardrail/routing checks (refusals, Hindi/Hinglish, small talk, follow-ups). Passing.
- `npm run eval:answers`: the PRD test set — 40 questions (24 covered, 8 tricky, 8 should-refuse) with expected facts taken
  from the stored official text.

Last full run (Oct 2, on Opus 5.5, before the switch to Sonnet and shorter answers):

| PRD metric | Result | Target |
|---|---|---|
| Answer accuracy | 100% (32/32) | ≥ 90% |
| Citation accuracy | 100% (27/27) | ≥ 95% |
| Honest refusals | 100% (8/8) | 100% |
| Unsupported numbers in official answers | 0 | 0 |
| Response time (p50 / p90) | 8.2 s / 21.7 s | < 5 s — **missed** |

**To do:** re-run on Sonnet 5.5 with the shorter-answer rules (~60–80¢; needs the daily cap raised for that run).
Spot checks on Sonnet: Japan answers in 4–6 s; web answers on request take 15–30 s.

## Changes to the metrics

- **Response time:** the < 5 s target holds for refusals, small talk and cached answers, and is close for official answers
  on Sonnet (4–6 s). Web answers can't meet it; they now run only when the person taps for them and show a "about 15 seconds" note.
  Proposed target: official answers p50 < 6 s; web answers < 30 s.
- **New metric:** share of answers that needed web search, by destination — the list of official sources to add next.

## Open questions

1. Should a few high-traffic gaps (Vietnam, Australia) get a weekly *pre-researched* web answer stored like an official page,
   so they answer in seconds without a live search?
2. Is $0.50/day the right cap once the link is shared publicly?
3. Own-voice read-aloud: built (ElevenLabs, signed so only Didi's answers can be spoken), but parked — it needs a paid plan ($6/month).
4. Embeddings: keep BM25, or choose an embedding model and move retrieval to pgvector?
