import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';

/** Brief §9: Opus for complex work, Sonnet for routine work. */
export const MODELS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5' } as const;
export type ModelTier = keyof typeof MODELS;
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Published per-token prices in micro-USD (Anthropic first-party API, from the
 * claude-api reference cached 2026-10-06). Re-check before relying on totals.
 * Unknown models (e.g. a fallback) are priced at the most expensive tier so
 * spend is never under-counted.
 */
export const PRICES_MICRO_USD_PER_TOKEN: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};
const MOST_EXPENSIVE = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 };

export interface ReasoningUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function costMicroUsd(model: string, u: ReasoningUsage): number {
  const p = PRICES_MICRO_USD_PER_TOKEN[model] ?? MOST_EXPENSIVE;
  return Math.ceil(u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite);
}

/** Worst case before the call: rough input size plus the full output allowance. */
export function estimateMaxCostMicroUsd(tier: ModelTier, inputChars: number, maxTokens: number): number {
  const p = PRICES_MICRO_USD_PER_TOKEN[MODELS[tier]]!;
  return Math.ceil(Math.ceil(inputChars / 3) * p.input + maxTokens * p.output);
}

export interface ReasoningTask<T> {
  /** Short name for logs and cost events, e.g. 'draft_script'. */
  name: string;
  tier: ModelTier;
  effort: Effort;
  maxTokens: number;
  system: string;
  user: string;
  schema: z.ZodType<T>;
}

export interface ReasoningResult<T> {
  output: T;
  /** The model that actually served the request (differs when a fallback ran). */
  model: string;
  servedByFallback: boolean;
  usage: ReasoningUsage;
  costMicroUsd: number;
  requestId: string | null;
  source: 'mock' | 'live';
}

export type ReasoningErrorKind = 'auth' | 'rate_limited' | 'overloaded' | 'invalid_request' | 'refused' | 'truncated' | 'unparseable' | 'transient' | 'budget';

export class ReasoningError extends Error {
  override readonly name = 'ReasoningError';
  constructor(
    readonly kind: ReasoningErrorKind,
    message: string,
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
  }
}

export interface ReasoningClient {
  readonly mode: 'mock' | 'live';
  run<T>(task: ReasoningTask<T>): Promise<ReasoningResult<T>>;
}

/**
 * Live client on the official SDK. Uses structured outputs (Zod), adaptive
 * thinking (always on for these models; depth via effort), and the server-side
 * refusal fallback. It never decides whether spending is allowed: callers go
 * through `runWithBudget`.
 */
export class AnthropicReasoningClient implements ReasoningClient {
  readonly mode = 'live' as const;
  private readonly client: Anthropic;

  constructor(opts: { apiKey?: string; client?: Anthropic; fetch?: typeof fetch; maxRetries?: number } = {}) {
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, fetch: opts.fetch, maxRetries: opts.maxRetries ?? 2 });
  }

  async run<T>(task: ReasoningTask<T>): Promise<ReasoningResult<T>> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: MODELS[task.tier],
        max_tokens: task.maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: task.effort, format: betaZodOutputFormat(task.schema) },
        system: [{ type: 'text', text: task.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: task.user }],
      });
    } catch (e) {
      throw mapError(e);
    }
    if (response.stop_reason === 'refusal') {
      throw new ReasoningError('refused', `${task.name}: declined (${response.stop_details?.category ?? 'no category'})`);
    }
    if (response.stop_reason === 'max_tokens') throw new ReasoningError('truncated', `${task.name}: hit max_tokens (${task.maxTokens})`);
    if (response.parsed_output == null) throw new ReasoningError('unparseable', `${task.name}: response did not match the schema`);
    const u = response.usage;
    const usage: ReasoningUsage = {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    };
    return {
      output: response.parsed_output as T,
      model: response.model,
      servedByFallback: response.model !== MODELS[task.tier],
      usage,
      costMicroUsd: costMicroUsd(response.model, usage),
      requestId: (response as { _request_id?: string | null })._request_id ?? null,
      source: 'live',
    };
  }
}

function mapError(e: unknown): ReasoningError {
  const retryAfter = (err: InstanceType<typeof Anthropic.APIError>) => {
    const h = err.headers?.get?.('retry-after');
    return h && /^\d+$/.test(h) ? Number(h) : null;
  };
  // Most specific first; never string-match messages. Messages never include the API key.
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new ReasoningError('auth', `Anthropic API: ${e.status} (check ANTHROPIC_API_KEY)`);
  if (e instanceof Anthropic.RateLimitError) return new ReasoningError('rate_limited', 'Anthropic API: rate limited', retryAfter(e));
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError || e instanceof Anthropic.UnprocessableEntityError) {
    return new ReasoningError('invalid_request', `Anthropic API: ${e.status} ${e.message}`);
  }
  if (e instanceof Anthropic.InternalServerError) return new ReasoningError(e.status === 529 ? 'overloaded' : 'transient', `Anthropic API: ${e.status}`, retryAfter(e));
  if (e instanceof Anthropic.APIConnectionError) return new ReasoningError('transient', 'Anthropic API: connection failed');
  if (e instanceof Anthropic.APIError) return new ReasoningError('transient', `Anthropic API: ${e.status ?? 'error'}`);
  // Not an HTTP error: the SDK could not parse the structured output (e.g. JSON cut off at max_tokens).
  if (e instanceof Anthropic.AnthropicError) return new ReasoningError('unparseable', 'structured output could not be parsed (possibly truncated at max_tokens)');
  return new ReasoningError('transient', e instanceof Error ? e.message : String(e));
}

export interface BudgetHooks {
  /** Usually authorizeSpend from @life/db. Must refuse when no cap is set. */
  authorize(estimateMicroUsd: number, task: { name: string; model: string }): Promise<{ ok: true; warning: string | null } | { ok: false; message: string }>;
  /** Usually recordCost from @life/db, source 'live' with estimated=false. */
  record(result: ReasoningResult<unknown>, task: { name: string }): Promise<void>;
  log?: (line: string) => void;
}

/** The only way the pipeline should call a paid model: check the cap first, record the actual cost after. */
export async function runWithBudget<T>(client: ReasoningClient, task: ReasoningTask<T>, hooks: BudgetHooks): Promise<ReasoningResult<T>> {
  if (client.mode === 'live') {
    const estimate = estimateMaxCostMicroUsd(task.tier, task.system.length + task.user.length, task.maxTokens);
    const decision = await hooks.authorize(estimate, { name: task.name, model: MODELS[task.tier] });
    if (!decision.ok) throw new ReasoningError('budget', `${task.name}: ${decision.message}`);
    if (decision.warning) hooks.log?.(`WARNING: ${decision.warning}`);
  }
  const result = await client.run(task);
  await hooks.record(result, task);
  return result;
}
