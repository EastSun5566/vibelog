// Measures AI design generation latency against live providers.
// Usage: node scripts/benchmark-ai-design.mjs [--runs N] provider:model [provider:primary,fallback ...]
// Specs may also come from VIBELOG_AI_BENCHMARK_MODELS (space separated). A comma-separated model
// list benchmarks the hedged fallback chain the app uses. Provider API keys come from the usual env.
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { createAiProvider, createAiProviderChain, DEFAULT_DESIGN_V2 } from '../dist/index.js';

/**
 * @typedef {{ kind: string, prompt: string, ok: boolean, durationMs: number, error?: string }} BenchmarkResult
 * @typedef {{ inputTokens: number }} UsageEvent
 */

const CANDIDATE_TIMEOUT_MS = 45_000;
const PROMPTS = [
  { kind: 'refine', prompt: 'Make the corners softer' },
  { kind: 'refine', prompt: 'Use a serif font for headings' },
  { kind: 'refine', prompt: 'Change the accent color to teal' },
  { kind: 'refine', prompt: 'Move the tag list above the recent posts on the homepage' },
  { kind: 'refine', prompt: '把標題字體放大一點' },
  { kind: 'redesign', prompt: 'Redesign the whole blog as a calm editorial magazine' },
  { kind: 'redesign', prompt: 'dark blue that feel like terminal' },
  { kind: 'redesign', prompt: 'Give it a brand-new look inspired by Swiss posters' },
  { kind: 'redesign', prompt: 'Start over from scratch with a playful, colorful style' },
  { kind: 'redesign', prompt: '整體改成極簡的日式風格' },
];

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { runs: { type: 'string', default: '1' } },
});
const runs = Number(values.runs);
const specs = positionals.length
  ? positionals
  : (process.env.VIBELOG_AI_BENCHMARK_MODELS ?? '').split(/\s+/u).filter(Boolean);
if (!specs.length || !Number.isInteger(runs) || runs < 1) {
  console.error('Usage: benchmark-ai-design.mjs [--runs N] provider:model[,fallback...] ...');
  process.exit(1);
}

// Keep provider logs off the report, but read token usage from them.
/** @type {UsageEvent[]} */
const usageEvents = [];
const consoleInfo = console.info;
/** @param {unknown[]} messages */
console.info = (...messages) => {
  const event = messages.find((message) => typeof message === 'string' && message.startsWith('{'));
  if (typeof event === 'string' && event.includes('"ai_model_usage"'))
    usageEvents.push(/** @type {UsageEvent} */ (JSON.parse(event)));
};
console.warn = () => undefined;
console.error = () => undefined;

/**
 * @param {number[]} samples
 * @param {number} fraction
 */
function percentile(samples, fraction) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}
/** @param {BenchmarkResult[]} results */
function summarize(results) {
  const durations = results.map((result) => result.durationMs);
  const successes = results.filter((result) => result.ok);
  return {
    requests: results.length,
    successRate: Number((successes.length / results.length).toFixed(2)),
    p50Ms: percentile(durations, 0.5),
    p90Ms: percentile(durations, 0.9),
    successP50Ms: percentile(successes.map((result) => result.durationMs), 0.5),
  };
}

const report = [];
for (const spec of specs) {
  const separator = spec.indexOf(':');
  const provider = spec.slice(0, separator);
  const [primary, ...fallbacks] = spec.slice(separator + 1).split(',');
  if (separator < 1 || !primary) throw new Error(`Invalid benchmark spec: ${spec}`);
  const ai = fallbacks.length
    ? createAiProviderChain(provider, primary, fallbacks)
    : createAiProvider(provider, primary);
  /** @type {BenchmarkResult[]} */
  const results = [];
  for (let run = 1; run <= runs; run += 1) {
    for (const { kind, prompt } of PROMPTS) {
      const sessionId = `benchmark-${String(run)}-${String(results.length)}`;
      const started = performance.now();
      try {
        await ai.generate(
          {
            blog: { title: 'Field notes', description: 'Essays on software and design', author: 'Writer' },
            contentProfile: {
              postCount: 24,
              tagCount: 8,
              averageLength: 'medium',
              codeUsage: 'some',
              imageUsage: 'some',
              mathUsage: 'none',
            },
            currentDesign: DEFAULT_DESIGN_V2,
            prompt,
          },
          {
            sessionId,
            // Chains enforce their own per-candidate deadline.
            ...(fallbacks.length ? {} : { signal: AbortSignal.timeout(CANDIDATE_TIMEOUT_MS) }),
          },
        );
        results.push({ kind, prompt, ok: true, durationMs: Math.round(performance.now() - started) });
      } catch (error) {
        results.push({
          kind,
          prompt,
          ok: false,
          durationMs: Math.round(performance.now() - started),
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
      }
    }
  }
  const usage = usageEvents.splice(0);
  report.push({
    spec,
    ...summarize(results),
    byKind: Object.fromEntries(
      ['refine', 'redesign'].map((kind) => [kind, summarize(results.filter((result) => result.kind === kind))]),
    ),
    meanInputTokens: usage.length
      ? Math.round(usage.reduce((total, event) => total + event.inputTokens, 0) / usage.length)
      : null,
    failures: results.filter((result) => !result.ok).map(({ prompt, error, durationMs }) => ({ prompt, error, durationMs })),
  });
}
consoleInfo(JSON.stringify({ event: 'ai_design_benchmark', runs, prompts: PROMPTS.length, report }, null, 2));
