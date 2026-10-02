// Which Claude model Didi uses, and the request options that depend on it.
// Default: Claude Haiku 4.5 (cheapest). Set CLAUDE_MODEL=claude-opus-5-5 or claude-sonnet-5-5 to trade cost for quality.
import type Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5";
const isHaiku = MODEL.startsWith("claude-haiku-4-5");

// USD per million input / output tokens, and per web search, for the spending caps.
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};
const [PRICE_IN, PRICE_OUT] = PRICES[MODEL] ?? [4, 20];
export const PRICE_SEARCH = 0.01;

export function costUsd(inputTokens: number, outputTokens: number, searches = 0) {
  return (inputTokens * PRICE_IN + outputTokens * PRICE_OUT) / 1e6 + searches * PRICE_SEARCH;
}

// Haiku 4.5 has no effort setting and no server-side refusal fallback; the Claude 5 models get
// low effort (fast, cheap) and fall back to another model if a safety classifier declines.
export function modelOptions(): Pick<Anthropic.Beta.MessageCreateParamsNonStreaming, "betas" | "fallbacks"> & { effort?: "low" } {
  return isHaiku ? {} : { effort: "low", betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
}

// The newer web search (with dynamic filtering) needs Opus/Sonnet 4.6+; Haiku uses the basic version,
// which also returns inline citations.
export function webSearchTool(): Anthropic.Beta.BetaToolUnion {
  return isHaiku
    ? { type: "web_search_20250305", name: "web_search", max_uses: 2, user_location: { type: "approximate", country: "IN" } }
    : { type: "web_search_20260209", name: "web_search", max_uses: 2, user_location: { type: "approximate", country: "IN" } };
}
