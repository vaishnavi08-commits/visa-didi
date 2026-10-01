// Run the weekly re-check locally: `npm run ingest`
import { runRecheck } from "../lib/ingest";
import { STALE_AFTER_DAYS, daysSince } from "../lib/store";

const { summary, store } = await runRecheck({ log: console.log });
console.log("\nSummary:", summary);
console.log("Chunks stored:", store.chunks.length);
const stale = Object.values(store.sources).filter((s) => s.lastVerified && daysSince(s.lastVerified) > STALE_AFTER_DAYS);
if (stale.length) console.log("Stale (>14 days unverified):", stale.map((s) => s.id).join(", "));
