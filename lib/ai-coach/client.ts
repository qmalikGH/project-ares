// Anthropic SDK singleton + cost helpers.
// Model defaults: claude-opus-4-7 with adaptive thinking.
// Static prompts get cache_control:ephemeral so repeat calls hit the prompt cache.
//
// Env loading: Next.js's .env.local is *not* trusted to win over the parent
// shell. If `ANTHROPIC_API_KEY` is exported empty in the shell (e.g. parent
// process pre-clears it), `process.env` will hold the empty string and the
// key from .env.local is shadowed. We side-load .env.local explicitly here.
import Anthropic from "@anthropic-ai/sdk";
import { config as loadEnv } from "dotenv";
import path from "node:path";
import fs from "node:fs";

let envSideLoaded = false;
function ensureEnvLoaded() {
  if (envSideLoaded) return;
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const parsed = loadEnv({ path: envPath, override: true }).parsed ?? {};
    // dotenv with override:true respects shell-set values; force-overwrite the
    // ones we care about when the shell value is empty.
    for (const k of ["ANTHROPIC_API_KEY"] as const) {
      if (parsed[k] && (!process.env[k] || process.env[k] === "")) {
        process.env[k] = parsed[k];
      }
    }
  }
  envSideLoaded = true;
}

declare global {

  var __anthropic: Anthropic | undefined;
}

/**
 * Lazy singleton — initialised on first `getAnthropic()` call.
 * Eager `process.env.ANTHROPIC_API_KEY` lookup at module-load time can race with
 * Next.js's env-var loading and produce "Could not resolve authentication method".
 */
export function getAnthropic(): Anthropic {
  if (!globalThis.__anthropic) {
    ensureEnvLoaded();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set in the environment");
    }
    globalThis.__anthropic = new Anthropic({ apiKey });
  }
  return globalThis.__anthropic;
}

// Back-compat: keep `anthropic` as an alias that lazy-resolves on first property access.
export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop) {
    const real = getAnthropic() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export const DEFAULT_MODEL = process.env.AI_MODEL_PRIMARY ?? "claude-opus-4-7";
export const FALLBACK_MODEL = process.env.AI_MODEL_FALLBACK ?? "claude-sonnet-4-6";

// Pricing per 1M tokens — kept in sync with shared/models.md.
const COST_TABLE: Record<string, { input: number; output: number }> = {
  "claude-opus-4-7": { input: 5.0, output: 25.0 },
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

export interface UsageCost {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number;
}

/**
 * Compute USD cost from a Claude API usage block.
 * Cache writes are billed at 1.25× input; cache reads at 0.1×.
 * See shared/prompt-caching.md (Economics).
 */
export function costFromUsage(
  model: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  },
): UsageCost {
  const rate = COST_TABLE[model] ?? COST_TABLE["claude-opus-4-7"];
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const inputCost = (usage.input_tokens / 1_000_000) * rate.input;
  const cacheWriteCost = (cacheWrite / 1_000_000) * rate.input * 1.25;
  const cacheReadCost = (cacheRead / 1_000_000) * rate.input * 0.1;
  const outputCost = (usage.output_tokens / 1_000_000) * rate.output;
  const costUsd = inputCost + cacheWriteCost + cacheReadCost + outputCost;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: cacheWrite,
    cacheReadInputTokens: cacheRead,
    costUsd: Math.round(costUsd * 10000) / 10000,
  };
}

/** Concatenate text blocks from a Message response. */
export function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
