import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import {
  createModels,
  createProvider,
  validateToolCall,
  type Api,
  type Context,
  type Model,
  type Models,
  type MutableModels,
  type ProviderEnv,
  type ProviderStreams,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { builtinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all';
import type { AiGenerationContext, AiProvider } from '../../types.js';
import type { DesignProposalInput } from '../../design/types.js';
import type { BlogDesignSpecV2 } from '../../design/schema-v2.js';
import { DESIGN_CATALOG_V2_INSTRUCTIONS } from '../../design/catalog-v2.js';
import { normalizeDesignV2 } from '../../design/normalize-v2.js';
import { applyDesignPatchV2 } from '../../design/patch-v2.js';
import { validateBlogDesignSpecV2 } from '../../design/schema-v2.js';
import { designToolV2, refineDesignToolV2 } from './tool-v2.js';
import { logger } from '../../core/index.js';

const DESIGN_TOOL_NAME = 'propose_design';
const REFINE_TOOL_NAME = 'refine_design';
const OLLAMA_PROVIDER = 'ollama';
const OLLAMA_BASE_URL = 'http://localhost:11434/v1';
const KEYLESS_OLLAMA_TRANSPORT_KEY = 'ollama-local';
const OPENCODE_PROVIDERS = new Set(['opencode', 'opencode-go']);
const LEGACY_AZURE_PROVIDER = 'azure-openai-responses';
const VIBELOG_USER_AGENT = 'VibeLog';
const AI_GENERATION_TIMEOUT_MS = 120_000;
const AI_FALLBACK_CANDIDATE_TIMEOUT_MS = 45_000;
const AI_HEDGE_DELAY_MS = 12_000;
function keylessOpenAICompletionsApi(): ProviderStreams {
  const api = openAICompletionsApi();
  const options = (input?: SimpleStreamOptions): SimpleStreamOptions => ({
    ...input,
    // OpenAI transport needs a key even for local providers; never send it to Ollama.
    apiKey: input?.apiKey ?? KEYLESS_OLLAMA_TRANSPORT_KEY,
    headers: { ...input?.headers, authorization: null },
  });
  return {
    stream: (model, context, input) => api.stream(model, context, options(input)),
    streamSimple: (model, context, input) => api.streamSimple(model, context, options(input)),
  };
}

function createOllamaProvider(modelId: string) {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? OLLAMA_BASE_URL;
  const model: Model<'openai-completions'> = {
    id: modelId,
    name: `${modelId} (Ollama)`,
    api: 'openai-completions',
    provider: OLLAMA_PROVIDER,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 32_000,
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  };
  return createProvider({
    id: OLLAMA_PROVIDER,
    name: 'Ollama',
    baseUrl,
    auth: { apiKey: { name: 'Ollama', resolve: () => Promise.resolve({ auth: {} }) } },
    models: [model],
    api: keylessOpenAICompletionsApi(),
  });
}
function providerId(provider: string): string {
  return provider === LEGACY_AZURE_PROVIDER ? 'azure' : provider;
}
function defaultModels(provider: string, modelId: string): MutableModels {
  const models = provider === OLLAMA_PROVIDER ? createModels() : builtinModels();
  if (provider === OLLAMA_PROVIDER) models.setProvider(createOllamaProvider(modelId));
  return models;
}
function requestEnv(provider: string): ProviderEnv | undefined {
  const legacy = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  return provider === 'google' && !process.env.GEMINI_API_KEY && legacy
    ? { GEMINI_API_KEY: legacy }
    : undefined;
}
function safeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const secrets = Object.entries(process.env).flatMap(([name, value]) =>
    value && value.length >= 8 && /(?:token|secret|api.?key|password)/i.test(name) ? [value] : [],
  );
  return secrets
    .reduce((output, secret) => output.replaceAll(secret, '[REDACTED]'), message)
    .replaceAll(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[REDACTED]')
    .slice(0, 500);
}
function safeToolValidationError(error: unknown): string {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const path = issue?.path
      .map((part) =>
        typeof part === 'number'
          ? String(part)
          : /^[a-zA-Z][a-zA-Z0-9-]{0,47}$/u.test(String(part))
            ? String(part)
            : 'field',
      )
      .join('.');
    return path ? `Invalid design value at ${path}` : 'Invalid design value';
  }
  const message = safeProviderError(error);
  const knownField = [
    'bodyFont',
    'headingFont',
    'appearance',
    'theme',
    'chrome',
    'pages',
    'description',
    'patches',
  ].find((field) => message.includes(field));
  return knownField
    ? `Invalid design tool arguments at ${knownField}`
    : 'Invalid design tool arguments';
}
export type AiProviderFailureKind =
  | 'cancelled'
  | 'configuration'
  | 'http'
  | 'network'
  | 'timeout'
  | 'upstream';
export interface AiProviderRequestErrorOptions extends ErrorOptions {
  kind?: AiProviderFailureKind;
  retryable?: boolean;
  status?: number;
}
export class AiProviderRequestError extends Error {
  readonly kind: AiProviderFailureKind;
  readonly retryable: boolean;
  readonly status?: number;
  constructor(message: string, options: AiProviderRequestErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'AiProviderRequestError';
    this.kind = options.kind ?? 'upstream';
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}
export class AiProviderTimeoutError extends AiProviderRequestError {
  constructor(options?: ErrorOptions) {
    super('AI provider request timed out', { ...options, kind: 'timeout', retryable: true });
    this.name = 'AiProviderTimeoutError';
  }
}
export function getAiProviderNames(): string[] {
  return [...getBuiltinProviders(), LEGACY_AZURE_PROVIDER, OLLAMA_PROVIDER];
}

type DesignTool = typeof designToolV2 | typeof refineDesignToolV2;
function designSystemPrompt(tools: DesignTool[], previousError?: string): string {
  const canPropose = tools.some((tool) => tool.name === DESIGN_TOOL_NAME);
  const canRefine = tools.some((tool) => tool.name === REFINE_TOOL_NAME);
  return [
    "You are VibeLog's blog presentation designer. Call exactly one tool.",
    canPropose && canRefine
      ? `Prefer ${REFINE_TOOL_NAME} for a focused or ambiguous request; preserve every unrelated choice in the current saved design. Use ${DESIGN_TOOL_NAME} only when the writer clearly asks for a broad redesign.`
      : canRefine
        ? 'Preserve every unrelated choice in the current saved design.'
        : '',
    canRefine
      ? `For ${REFINE_TOOL_NAME}, return only necessary JSON Patch operations; use move only for homepage region reordering.`
      : '',
    canPropose ? `For ${DESIGN_TOOL_NAME}, create a complete version 2 VibeLog design.` : '',
    DESIGN_CATALOG_V2_INSTRUCTIONS,
    'Ensure text and accent colors each have WCAG AA contrast against the background.',
    previousError
      ? `Previous proposal error: ${previousError}. Correct it with the available tool.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

class AiDesignValidationError extends Error {
  constructor(
    message: string,
    readonly selectedTool?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AiDesignValidationError';
  }
}

interface ProviderRequestMetadata {
  networkFailure: boolean;
  shouldRetry?: boolean;
  status?: number;
}
function requestMetadataFetch(metadata: ProviderRequestMetadata): typeof globalThis.fetch {
  const request = globalThis.fetch;
  return async (input, init) => {
    try {
      const response = await request(input, init);
      metadata.status = response.status;
      const shouldRetry = response.headers.get('x-should-retry');
      if (shouldRetry === 'true') metadata.shouldRetry = true;
      if (shouldRetry === 'false') metadata.shouldRetry = false;
      return response;
    } catch (error) {
      metadata.networkFailure = true;
      throw error;
    }
  };
}
function retryableStatus(status: number | undefined): boolean {
  return (
    status === 404 ||
    status === 408 ||
    status === 409 ||
    status === 429 ||
    (status !== undefined && status >= 500)
  );
}
function isTimeoutSignal(signal: AbortSignal): boolean {
  const reason: unknown = signal.reason;
  return (
    signal.aborted &&
    typeof reason === 'object' &&
    reason !== null &&
    (reason as Record<string, unknown>).name === 'TimeoutError'
  );
}
function providerRequestError(
  error: unknown,
  metadata: ProviderRequestMetadata,
  signal: AbortSignal,
): AiProviderRequestError {
  if (signal.aborted) {
    if (isTimeoutSignal(signal)) return new AiProviderTimeoutError({ cause: error });
    return new AiProviderRequestError('AI provider request was cancelled', {
      cause: error,
      kind: 'cancelled',
      retryable: false,
    });
  }
  const detail = safeProviderError(error);
  if (/no api key|unknown ai model|unsupported ai provider/iu.test(detail)) {
    return new AiProviderRequestError('AI provider configuration failed', {
      cause: error,
      kind: 'configuration',
      retryable: false,
      status: metadata.status,
    });
  }
  const retryable =
    metadata.shouldRetry ?? (metadata.networkFailure || retryableStatus(metadata.status));
  return new AiProviderRequestError(
    metadata.status === undefined
      ? 'AI provider request failed'
      : `AI provider request failed with HTTP ${String(metadata.status)}`,
    {
      cause: error,
      kind: metadata.networkFailure
        ? 'network'
        : metadata.status === undefined
          ? 'upstream'
          : 'http',
      retryable,
      status: metadata.status,
    },
  );
}

export class PiAiProvider implements AiProvider {
  readonly model: Model<Api>;
  constructor(
    readonly name: string,
    readonly modelId: string,
    private readonly models: Models = defaultModels(name, modelId),
  ) {
    if (!getAiProviderNames().includes(name) && !models.getProvider(name))
      throw new Error(`Unsupported AI provider: ${name}`);
    const model = models.getModel(providerId(name), modelId);
    if (!model) throw new Error(`Unknown AI model: ${name}@${modelId}`);
    this.model = model;
    logger.info(`AI provider: ${name} (${modelId})`);
  }
  private async generateOnce(
    input: DesignProposalInput,
    sessionId: string,
    signal: AbortSignal,
    tools: DesignTool[],
    previousError?: string,
  ): Promise<BlogDesignSpecV2> {
    const selectedTool = tools.length === 1 ? tools[0]?.name : undefined;
    const context: Context = {
      systemPrompt: designSystemPrompt(tools, previousError),
      messages: [{ role: 'user', content: JSON.stringify(input), timestamp: Date.now() }],
      tools,
    };
    const startedAt = Date.now();
    let response;
    const openCode = OPENCODE_PROVIDERS.has(this.name);
    const requestMetadata: ProviderRequestMetadata = { networkFailure: false };
    try {
      response = await this.models.complete(this.model, context, {
        temperature: 0.2,
        signal,
        env: requestEnv(this.name),
        ...(openCode
          ? {
              fetch: requestMetadataFetch(requestMetadata),
              maxRetries: 0,
              sessionId,
              headers: { 'user-agent': VIBELOG_USER_AGENT },
            }
          : {}),
      });
    } catch (error) {
      throw providerRequestError(error, requestMetadata, signal);
    }
    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      const failure = providerRequestError(
        response.errorMessage ?? response.stopReason,
        requestMetadata,
        signal,
      );
      if (
        failure instanceof AiProviderTimeoutError ||
        failure.kind === 'cancelled' ||
        failure.kind === 'configuration' ||
        failure.kind === 'network'
      )
        throw failure;
      if (requestMetadata.status === undefined || requestMetadata.status < 400) {
        throw new AiProviderRequestError(failure.message, {
          cause: failure,
          kind: 'upstream',
          retryable: true,
        });
      }
      throw failure;
    }
    logger.info(
      JSON.stringify({
        event: 'ai_model_usage',
        operationId: sessionId,
        provider: this.name,
        model: this.modelId,
        tools: tools.map((tool) => tool.name),
        stopReason: response.stopReason,
        inputTokens: response.usage.input,
        outputTokens: response.usage.output,
        cacheReadTokens: response.usage.cacheRead,
        totalTokens: response.usage.totalTokens,
        durationMs: Date.now() - startedAt,
      }),
    );
    if (response.stopReason === 'length')
      throw new Error('AI response exceeded the model output limit.');
    const toolCalls = response.content.filter((block) => block.type === 'toolCall');
    if (response.stopReason !== 'toolUse' || toolCalls.length !== 1)
      throw new AiDesignValidationError('AI must call exactly one design tool.', selectedTool);
    const [toolCall] = toolCalls;
    if (!tools.some((tool) => tool.name === toolCall.name))
      throw new AiDesignValidationError('AI called an unexpected design tool.', selectedTool);
    let candidate: unknown;
    try {
      candidate = validateToolCall(tools, toolCall);
    } catch (error) {
      throw new AiDesignValidationError(
        `AI returned invalid arguments for ${toolCall.name}: ${safeToolValidationError(error)}`,
        toolCall.name,
        { cause: error },
      );
    }
    try {
      return toolCall.name === REFINE_TOOL_NAME
        ? applyDesignPatchV2(input.currentDesign, (candidate as { patches: unknown }).patches)
        : normalizeDesignV2(validateBlogDesignSpecV2(candidate));
    } catch (error) {
      throw new AiDesignValidationError(
        `AI returned an invalid ${toolCall.name === REFINE_TOOL_NAME ? 'patch' : 'design'}: ${safeToolValidationError(error)}`,
        toolCall.name,
        { cause: error },
      );
    }
  }
  async generate(
    input: DesignProposalInput,
    context?: AiGenerationContext,
  ): Promise<BlogDesignSpecV2> {
    const sessionId = context?.sessionId ?? randomUUID();
    const signal = context?.signal ?? AbortSignal.timeout(AI_GENERATION_TIMEOUT_MS);
    // Offering both tools on every request benchmarked faster and more reliable than refine-only.
    const tools: DesignTool[] = [designToolV2, refineDesignToolV2];
    try {
      return await this.generateOnce(input, sessionId, signal, tools);
    } catch (firstError) {
      if (firstError instanceof AiProviderRequestError) throw firstError;
      const selectedTool =
        firstError instanceof AiDesignValidationError ? firstError.selectedTool : undefined;
      try {
        return await this.generateOnce(
          input,
          sessionId,
          signal,
          selectedTool ? tools.filter((tool) => tool.name === selectedTool) : tools,
          safeProviderError(firstError),
        );
      } catch (secondError) {
        if (secondError instanceof AiProviderRequestError) throw secondError;
        throw new Error(
          `AI could not create a safe design after one correction: ${safeProviderError(secondError)}. Your current design was not changed.`,
          { cause: secondError },
        );
      }
    }
  }
}
export function createAiProvider(name: string, modelId: string): PiAiProvider {
  return new PiAiProvider(name, modelId);
}

function hedgeDelayFromEnv(): number {
  const value = Number(process.env.VIBELOG_AI_HEDGE_DELAY_MS);
  return Number.isFinite(value) && value > 0 ? value : AI_HEDGE_DELAY_MS;
}
export class FallbackAiProvider implements AiProvider {
  readonly modelId: string;
  private readonly candidates: AiProvider[];
  constructor(
    readonly name: string,
    primaryModelId: string,
    fallbackModelIds: string[],
    factory: (name: string, modelId: string) => AiProvider = createAiProvider,
    private readonly candidateTimeoutMs = AI_FALLBACK_CANDIDATE_TIMEOUT_MS,
    private readonly hedgeDelayMs = AI_HEDGE_DELAY_MS,
  ) {
    const modelIds = [primaryModelId, ...fallbackModelIds];
    if (modelIds.some((modelId) => modelId.trim().length === 0))
      throw new Error('AI model IDs must not be empty');
    if (new Set(modelIds).size !== modelIds.length)
      throw new Error('AI fallback models must be unique and must not repeat the primary model');
    this.modelId = primaryModelId;
    this.candidates = modelIds.map((modelId) => factory(name, modelId));
  }
  /**
   * Tries candidates in order. A retryable failure starts the next candidate at once, and a
   * candidate still running after the hedge delay gets the next one started beside it. The first
   * valid design wins; every other request still in flight is aborted.
   */
  generate(input: DesignProposalInput, context?: AiGenerationContext): Promise<BlogDesignSpecV2> {
    const operationId = context?.sessionId ?? randomUUID();
    const startedAt = Date.now();
    const running = new Map<number, AbortController>();
    let nextIndex = 0;
    let hedged = false;
    let settled = false;
    let stopLaunching = false;
    let permanentFailure: unknown;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    const log = (level: 'info' | 'warn' | 'error', event: string, fields: object) => {
      logger[level](
        JSON.stringify({
          event,
          operationId,
          primaryModel: this.modelId,
          ...fields,
          hedged,
          durationMs: Date.now() - startedAt,
        }),
      );
    };
    return new Promise((resolve, reject) => {
      const settle = () => {
        settled = true;
        clearTimeout(hedgeTimer);
        for (const controller of running.values())
          controller.abort(new DOMException('Another AI model answered first', 'AbortError'));
        running.clear();
      };
      const fail = (failedModel: string, error: unknown) => {
        const failure = error instanceof AiProviderRequestError ? error : undefined;
        log('error', 'ai_model_failed', {
          failedModel,
          reason: failure?.kind ?? 'validation',
          status: failure?.status,
        });
        settle();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const canLaunch = () =>
        !settled &&
        !stopLaunching &&
        !context?.signal?.aborted &&
        nextIndex < this.candidates.length;
      const launch = () => {
        const index = nextIndex++;
        const candidate = this.candidates[index];
        if (!candidate) return;
        const controller = new AbortController();
        running.set(index, controller);
        clearTimeout(hedgeTimer);
        if (canLaunch())
          hedgeTimer = setTimeout(() => {
            if (!canLaunch() || nextIndex !== index + 1) return;
            hedged = true;
            log('warn', 'ai_model_fallback', {
              failedModel: candidate.modelId,
              nextModel: this.candidates[nextIndex]?.modelId,
              reason: 'hedge',
            });
            launch();
          }, this.hedgeDelayMs);
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(this.candidateTimeoutMs),
          ...(context?.signal ? [context.signal] : []),
        ]);
        const request = async () => candidate.generate(input, { sessionId: operationId, signal });
        request().then(
          (design) => {
            if (settled) return;
            log('info', 'ai_model_selected', {
              selectedModel: candidate.modelId,
              fallback: index > 0,
            });
            running.delete(index);
            settle();
            resolve(design);
          },
          (error: unknown) => {
            if (settled) return;
            running.delete(index);
            const failure = error instanceof AiProviderRequestError ? error : undefined;
            // A configuration error or caller cancellation would fail every candidate the same way.
            if (failure?.kind === 'configuration' || context?.signal?.aborted) {
              fail(candidate.modelId, error);
              return;
            }
            if (!failure?.retryable) {
              // Start nothing new, but let a hedge already in flight finish.
              permanentFailure ??= error;
              stopLaunching = true;
              clearTimeout(hedgeTimer);
            }
            const [takeover] = running.keys();
            if (!canLaunch() && takeover === undefined) {
              fail(candidate.modelId, permanentFailure ?? error);
              return;
            }
            log('warn', 'ai_model_fallback', {
              failedModel: candidate.modelId,
              nextModel: this.candidates[canLaunch() ? nextIndex : (takeover ?? index)]?.modelId,
              reason: failure?.kind ?? 'validation',
              status: failure?.status,
            });
            if (canLaunch()) launch();
          },
        );
      };
      launch();
    });
  }
}
export function createAiProviderChain(
  name: string,
  primaryModelId: string,
  fallbackModelIds: string[] = [],
): AiProvider {
  return fallbackModelIds.length === 0
    ? createAiProvider(name, primaryModelId)
    : new FallbackAiProvider(
        name,
        primaryModelId,
        fallbackModelIds,
        createAiProvider,
        AI_FALLBACK_CANDIDATE_TIMEOUT_MS,
        hedgeDelayFromEnv(),
      );
}
