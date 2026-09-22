import { randomUUID } from 'node:crypto';
import { Type, createModels, createProvider, validateToolCall, type Api, type Context, type Model, type Models, type MutableModels, type ProviderEnv, type ProviderStreams, type SimpleStreamOptions, type Tool } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { builtinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all';
import type { AiGenerationContext, AiProvider } from '../../types.js';
import type { BlogDesignSpec, DesignProposalInput } from '../../design/types.js';
import { DESIGN_CATALOG_INSTRUCTIONS } from '../../design/catalog.js';
import { normalizeDesignDecoration } from '../../design/normalize.js';
import { validateBlogDesignSpec } from '../../design/validate.js';
import { logger } from '../../core/index.js';

const DESIGN_TOOL_NAME = 'propose_design';
const OLLAMA_PROVIDER = 'ollama';
const OLLAMA_BASE_URL = 'http://localhost:11434/v1';
const KEYLESS_OLLAMA_TRANSPORT_KEY = 'ollama-local';
const OPENCODE_PROVIDERS = new Set(['opencode', 'opencode-go']);
const VIBELOG_USER_AGENT = 'VibeLog';
const AI_GENERATION_TIMEOUT_MS = 120_000;
const AI_FALLBACK_CANDIDATE_TIMEOUT_MS = 45_000;
const enumType = <T extends string>(values: readonly T[]) => Type.Union(values.map((value) => Type.Literal(value)));
const homeSection = Type.Union([
  Type.Object({ type: Type.Literal('intro'), variant: enumType(['minimal', 'centered', 'split']), showAuthor: Type.Boolean() }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('featured-posts'), variant: enumType(['hero', 'split']), count: Type.Union([Type.Literal(1), Type.Literal(2)]) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('recent-posts'), variant: enumType(['list', 'cards', 'grid']), limit: Type.Union([Type.Literal(3), Type.Literal(5), Type.Literal(6), Type.Literal(9)]), columns: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)])) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('topics'), variant: enumType(['list', 'cloud']), limit: Type.Union([Type.Literal(6), Type.Literal(12), Type.Literal(24)]) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('author'), variant: enumType(['compact', 'profile']) }, { additionalProperties: false }),
]);
const designTool: Tool = {
  name: DESIGN_TOOL_NAME,
  description: 'Propose one complete VibeLog presentation using only the supported blog design catalog.',
  parameters: Type.Object({
    version: Type.Literal(1),
    theme: Type.Object({
      motif: enumType(['minimal', 'editorial', 'notebook']), appearance: enumType(['light', 'dark']),
      colors: Type.Object({ background: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), surface: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), text: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), muted: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), accent: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), border: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }) }, { additionalProperties: false }),
      typography: Type.Object({ bodyFont: enumType(['system-sans', 'system-serif', 'system-mono']), headingFont: enumType(['system-sans', 'system-serif', 'system-mono']), scale: enumType(['compact', 'comfortable', 'large']) }, { additionalProperties: false }),
      layout: Type.Object({ contentWidth: enumType(['narrow', 'medium', 'wide']), density: enumType(['compact', 'comfortable']), radius: enumType(['none', 'soft', 'round']) }, { additionalProperties: false }),
    }, { additionalProperties: false }),
    chrome: Type.Object({ header: Type.Object({ variant: enumType(['compact', 'centered', 'masthead']) }, { additionalProperties: false }), footer: Type.Object({ variant: enumType(['minimal', 'profile']) }, { additionalProperties: false }) }, { additionalProperties: false }),
    pages: Type.Object({
      home: Type.Object({ sections: Type.Array(homeSection, { minItems: 1, maxItems: 5 }) }, { additionalProperties: false }),
      index: Type.Object({ layout: enumType(['list', 'grid', 'magazine']), itemVariant: enumType(['divided', 'cards', 'numbered']), columns: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)])), showDescription: Type.Boolean(), showTags: Type.Boolean() }, { additionalProperties: false }),
      article: Type.Object({ layout: enumType(['reading', 'wide', 'with-aside']), header: enumType(['simple', 'editorial']), toc: enumType(['auto-inline', 'auto-aside', 'hidden']), metadata: enumType(['compact', 'detailed']), navigation: enumType(['links', 'cards']), codeBlock: enumType(['plain', 'panel']) }, { additionalProperties: false }),
    }, { additionalProperties: false }),
    styles: Type.Object({ rules: Type.Array(Type.Object({
      target: enumType(['site.header', 'home.intro', 'home.sections', 'posts.items', 'article.header', 'article.prose', 'article.toc', 'site.footer']),
      declarations: Type.Object({ textAlign: Type.Optional(enumType(['start', 'center'])), paddingBlock: Type.Optional(enumType(['none', 'sm', 'md', 'lg', 'xl'])), gap: Type.Optional(enumType(['sm', 'md', 'lg', 'xl'])), surface: Type.Optional(enumType(['transparent', 'background', 'surface'])), border: Type.Optional(enumType(['none', 'hairline', 'strong'])), width: Type.Optional(enumType(['reading', 'content', 'full'])) }, { additionalProperties: false }),
    }, { additionalProperties: false }), { maxItems: 8 }) }, { additionalProperties: false }),
    description: Type.String({ minLength: 1, maxLength: 240 }),
  }, { additionalProperties: false }),
};

function keylessOpenAICompletionsApi(): ProviderStreams {
  const api = openAICompletionsApi();
  const options = (input?: SimpleStreamOptions): SimpleStreamOptions => ({
    ...input,
    // pi-ai 0.80.7 requires a non-empty key to construct its OpenAI client,
    // even for keyless local providers. Keep that compatibility value inside
    // the transport and explicitly omit the corresponding HTTP auth header.
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
  const model: Model<'openai-completions'> = { id: modelId, name: `${modelId} (Ollama)`, api: 'openai-completions', provider: OLLAMA_PROVIDER, baseUrl, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 32_000, compat: { supportsDeveloperRole: false, supportsReasoningEffort: false } };
  return createProvider({ id: OLLAMA_PROVIDER, name: 'Ollama', baseUrl, auth: { apiKey: { name: 'Ollama', resolve: () => Promise.resolve({ auth: {} }) } }, models: [model], api: keylessOpenAICompletionsApi() });
}
function defaultModels(provider: string, modelId: string): MutableModels {
  const models = provider === OLLAMA_PROVIDER ? createModels() : builtinModels();
  if (provider === OLLAMA_PROVIDER) models.setProvider(createOllamaProvider(modelId));
  return models;
}
function requestEnv(provider: string): ProviderEnv | undefined { const legacy = process.env.GOOGLE_GENERATIVE_AI_API_KEY; return provider === 'google' && !process.env.GEMINI_API_KEY && legacy ? { GEMINI_API_KEY: legacy } : undefined; }
function safeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const secrets = Object.entries(process.env).flatMap(([name, value]) => value && value.length >= 8 && /(?:token|secret|api.?key|password)/i.test(name) ? [value] : []);
  return secrets.reduce((output, secret) => output.replaceAll(secret, '[REDACTED]'), message).replaceAll(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[REDACTED]').slice(0, 500);
}
function safeToolValidationError(error: unknown): string {
  const [message] = safeProviderError(error).split('\n\nReceived arguments:');
  return message || 'Unknown validation error';
}
export type AiProviderFailureKind = 'cancelled' | 'configuration' | 'http' | 'network' | 'timeout' | 'upstream';
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
  constructor(options?: ErrorOptions) { super('AI provider request timed out', { ...options, kind: 'timeout', retryable: true }); this.name = 'AiProviderTimeoutError'; }
}
export function getAiProviderNames(): string[] { return [...getBuiltinProviders(), OLLAMA_PROVIDER]; }

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
  return status === 404 || status === 408 || status === 409 || status === 429 || (status !== undefined && status >= 500);
}
function isTimeoutSignal(signal: AbortSignal): boolean {
  const reason: unknown = signal.reason;
  return signal.aborted && typeof reason === 'object' && reason !== null && (reason as Record<string, unknown>).name === 'TimeoutError';
}
function providerRequestError(error: unknown, metadata: ProviderRequestMetadata, signal: AbortSignal): AiProviderRequestError {
  if (signal.aborted) {
    if (isTimeoutSignal(signal)) return new AiProviderTimeoutError({ cause: error });
    return new AiProviderRequestError('AI provider request was cancelled', { cause: error, kind: 'cancelled', retryable: false });
  }
  const detail = safeProviderError(error);
  if (/no api key|unknown ai model|unsupported ai provider/iu.test(detail)) {
    return new AiProviderRequestError('AI provider configuration failed', { cause: error, kind: 'configuration', retryable: false, status: metadata.status });
  }
  const retryable = metadata.shouldRetry ?? (metadata.networkFailure || retryableStatus(metadata.status));
  return new AiProviderRequestError(metadata.status === undefined ? 'AI provider request failed' : `AI provider request failed with HTTP ${String(metadata.status)}`, {
    cause: error,
    kind: metadata.networkFailure ? 'network' : metadata.status === undefined ? 'upstream' : 'http',
    retryable,
    status: metadata.status,
  });
}

export class PiAiProvider implements AiProvider {
  readonly model: Model<Api>;
  constructor(readonly name: string, readonly modelId: string, private readonly models: Models = defaultModels(name, modelId)) {
    if (!getAiProviderNames().includes(name) && !models.getProvider(name)) throw new Error(`Unsupported AI provider: ${name}`);
    const model = models.getModel(name, modelId);
    if (!model) throw new Error(`Unknown AI model: ${name}@${modelId}`);
    this.model = model;
    logger.info(`AI provider: ${name} (${modelId})`);
  }
  private async generateOnce(input: DesignProposalInput, sessionId: string, signal: AbortSignal, previousError?: string): Promise<BlogDesignSpec> {
    const context: Context = {
      systemPrompt: `You are VibeLog's blog presentation designer. Call ${DESIGN_TOOL_NAME} exactly once with a complete version 1 design. ${DESIGN_CATALOG_INSTRUCTIONS} Ensure text and accent colors each have WCAG AA contrast against the background.${previousError ? ` Previous proposal error: ${previousError}. Correct it.` : ''}`,
      messages: [{ role: 'user', content: JSON.stringify(input), timestamp: Date.now() }], tools: [designTool],
    };
    let response;
    const openCode = OPENCODE_PROVIDERS.has(this.name);
    const requestMetadata: ProviderRequestMetadata = { networkFailure: false };
    try {
      response = await this.models.complete(this.model, context, {
        temperature: 0.2, signal,
        env: requestEnv(this.name),
        ...(openCode ? { fetch: requestMetadataFetch(requestMetadata), maxRetries: 0, sessionId, headers: { 'user-agent': VIBELOG_USER_AGENT, 'x-opencode-session': sessionId } } : {}),
      });
    } catch (error) {
      throw providerRequestError(error, requestMetadata, signal);
    }
    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      const failure = providerRequestError(response.errorMessage ?? response.stopReason, requestMetadata, signal);
      if (failure instanceof AiProviderTimeoutError || failure.kind === 'cancelled' || failure.kind === 'configuration' || failure.kind === 'network') throw failure;
      if (requestMetadata.status === undefined || requestMetadata.status < 400) {
        throw new AiProviderRequestError(failure.message, { cause: failure, kind: 'upstream', retryable: true });
      }
      throw failure;
    }
    if (response.stopReason === 'length') throw new Error('AI response exceeded the model output limit.');
    const toolCalls = response.content.filter((block) => block.type === 'toolCall');
    if (response.stopReason !== 'toolUse' || toolCalls.length !== 1) throw new Error(`AI must call ${DESIGN_TOOL_NAME} exactly once.`);
    const [toolCall] = toolCalls;
    if (toolCall.name !== DESIGN_TOOL_NAME) throw new Error(`AI called an unexpected tool: ${toolCall.name}`);
    let candidate: unknown;
    try { candidate = validateToolCall([designTool], toolCall); }
    catch (error) { throw new Error(`AI returned invalid arguments for ${DESIGN_TOOL_NAME}: ${safeToolValidationError(error)}`); }
    return normalizeDesignDecoration(validateBlogDesignSpec(candidate));
  }
  async generate(input: DesignProposalInput, context?: AiGenerationContext): Promise<BlogDesignSpec> {
    const sessionId = context?.sessionId ?? randomUUID();
    const signal = context?.signal ?? AbortSignal.timeout(AI_GENERATION_TIMEOUT_MS);
    try { return await this.generateOnce(input, sessionId, signal); }
    catch (firstError) {
      if (firstError instanceof AiProviderRequestError) throw firstError;
      try { return await this.generateOnce(input, sessionId, signal, safeProviderError(firstError)); }
      catch (secondError) {
        if (secondError instanceof AiProviderRequestError) throw secondError;
        throw new Error(`AI could not create a safe design after one correction: ${safeProviderError(secondError)}. Your current design was not changed.`, { cause: secondError });
      }
    }
  }
}
export function createAiProvider(name: string, modelId: string): PiAiProvider { return new PiAiProvider(name, modelId); }

export class FallbackAiProvider implements AiProvider {
  readonly modelId: string;
  private readonly candidates: AiProvider[];
  constructor(readonly name: string, primaryModelId: string, fallbackModelIds: string[], factory: (name: string, modelId: string) => AiProvider = createAiProvider, private readonly candidateTimeoutMs = AI_FALLBACK_CANDIDATE_TIMEOUT_MS) {
    const modelIds = [primaryModelId, ...fallbackModelIds];
    if (modelIds.some((modelId) => modelId.trim().length === 0)) throw new Error('AI model IDs must not be empty');
    if (new Set(modelIds).size !== modelIds.length) throw new Error('AI fallback models must be unique and must not repeat the primary model');
    this.modelId = primaryModelId;
    this.candidates = modelIds.map((modelId) => factory(name, modelId));
  }
  async generate(input: DesignProposalInput, context?: AiGenerationContext): Promise<BlogDesignSpec> {
    const operationId = context?.sessionId ?? randomUUID();
    const startedAt = Date.now();
    for (const [index, candidate] of this.candidates.entries()) {
      const timeoutSignal = AbortSignal.timeout(this.candidateTimeoutMs);
      const signal = context?.signal ? AbortSignal.any([context.signal, timeoutSignal]) : timeoutSignal;
      try {
        const theme = await candidate.generate(input, { sessionId: operationId, signal });
        logger.info(JSON.stringify({ event: 'ai_model_selected', operationId, primaryModel: this.modelId, selectedModel: candidate.modelId, fallback: index > 0, durationMs: Date.now() - startedAt }));
        return theme;
      } catch (error) {
        const failure = error instanceof AiProviderRequestError ? error : undefined;
        const hasFallback = index + 1 < this.candidates.length;
        if (failure?.retryable && hasFallback && !context?.signal?.aborted) {
          logger.warn(JSON.stringify({ event: 'ai_model_fallback', operationId, primaryModel: this.modelId, failedModel: candidate.modelId, nextModel: this.candidates[index + 1]?.modelId, reason: failure.kind, status: failure.status, durationMs: Date.now() - startedAt }));
          continue;
        }
        logger.error(JSON.stringify({ event: 'ai_model_failed', operationId, primaryModel: this.modelId, failedModel: candidate.modelId, reason: failure?.kind ?? 'validation', status: failure?.status, durationMs: Date.now() - startedAt }));
        throw error;
      }
    }
    throw new AiProviderRequestError('AI provider chain exhausted', { kind: 'upstream', retryable: false });
  }
}
export function createAiProviderChain(name: string, primaryModelId: string, fallbackModelIds: string[] = []): AiProvider {
  return fallbackModelIds.length === 0 ? createAiProvider(name, primaryModelId) : new FallbackAiProvider(name, primaryModelId, fallbackModelIds);
}
