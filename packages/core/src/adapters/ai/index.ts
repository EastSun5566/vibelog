import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { createModels, createProvider, validateToolCall, type Api, type Context, type Model, type Models, type MutableModels, type ProviderEnv, type ProviderStreams, type SimpleStreamOptions } from '@earendil-works/pi-ai';
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
const VIBELOG_USER_AGENT = 'VibeLog';
const AI_GENERATION_TIMEOUT_MS = 120_000;
const AI_FALLBACK_CANDIDATE_TIMEOUT_MS = 45_000;
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
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const path = issue?.path.map((part) => typeof part === 'number' ? String(part) : /^[a-zA-Z][a-zA-Z0-9-]{0,47}$/u.test(String(part)) ? String(part) : 'field').join('.');
    return path ? `Invalid design value at ${path}` : 'Invalid design value';
  }
  const message = safeProviderError(error);
  const knownField = ['bodyFont', 'headingFont', 'appearance', 'theme', 'chrome', 'pages', 'description', 'patches'].find((field) => message.includes(field));
  return knownField ? `Invalid design tool arguments at ${knownField}` : 'Invalid design tool arguments';
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

class AiDesignValidationError extends Error {
  constructor(message: string, readonly selectedTool?: typeof DESIGN_TOOL_NAME | typeof REFINE_TOOL_NAME, options?: ErrorOptions) {
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
  private async generateOnce(input: DesignProposalInput, sessionId: string, signal: AbortSignal, previousError?: string, selectedTool?: typeof DESIGN_TOOL_NAME | typeof REFINE_TOOL_NAME): Promise<BlogDesignSpecV2> {
    const tools = selectedTool === DESIGN_TOOL_NAME ? [designToolV2] : selectedTool === REFINE_TOOL_NAME ? [refineDesignToolV2] : [designToolV2, refineDesignToolV2];
    const context: Context = {
      systemPrompt: `You are VibeLog's blog presentation designer. Call exactly one tool. Prefer ${REFINE_TOOL_NAME} for a focused or ambiguous request; preserve every unrelated choice in the current saved design. Use ${DESIGN_TOOL_NAME} only when the writer clearly asks for a broad redesign. For ${REFINE_TOOL_NAME}, return only necessary JSON Patch operations; use move only for homepage region reordering. ${selectedTool === REFINE_TOOL_NAME ? '' : `For ${DESIGN_TOOL_NAME}, create a complete version 2 VibeLog design. `}${DESIGN_CATALOG_V2_INSTRUCTIONS} Ensure text and accent colors each have WCAG AA contrast against the background.${previousError ? ` Previous proposal error: ${previousError}. Correct it with the available tool.` : ''}`,
      messages: [{ role: 'user', content: JSON.stringify(input), timestamp: Date.now() }], tools,
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
    if (response.stopReason !== 'toolUse' || toolCalls.length !== 1) throw new AiDesignValidationError('AI must call exactly one design tool.', selectedTool);
    const [toolCall] = toolCalls;
    if (toolCall.name !== DESIGN_TOOL_NAME && toolCall.name !== REFINE_TOOL_NAME) throw new AiDesignValidationError('AI called an unexpected design tool.', selectedTool);
    if (selectedTool && toolCall.name !== selectedTool) throw new AiDesignValidationError('AI changed design mode during correction.', selectedTool);
    let candidate: unknown;
    try { candidate = validateToolCall(tools, toolCall); }
    catch (error) { throw new AiDesignValidationError(`AI returned invalid arguments for ${toolCall.name}: ${safeToolValidationError(error)}`, toolCall.name, { cause: error }); }
    try {
      return toolCall.name === REFINE_TOOL_NAME
        ? applyDesignPatchV2(input.currentDesign, (candidate as { patches: unknown }).patches)
        : normalizeDesignV2(validateBlogDesignSpecV2(candidate));
    } catch (error) {
      throw new AiDesignValidationError(`AI returned an invalid ${toolCall.name === REFINE_TOOL_NAME ? 'patch' : 'design'}: ${safeToolValidationError(error)}`, toolCall.name, { cause: error });
    }
  }
  async generate(input: DesignProposalInput, context?: AiGenerationContext): Promise<BlogDesignSpecV2> {
    const sessionId = context?.sessionId ?? randomUUID();
    const signal = context?.signal ?? AbortSignal.timeout(AI_GENERATION_TIMEOUT_MS);
    try { return await this.generateOnce(input, sessionId, signal); }
    catch (firstError) {
      if (firstError instanceof AiProviderRequestError) throw firstError;
      try { return await this.generateOnce(input, sessionId, signal, safeProviderError(firstError), firstError instanceof AiDesignValidationError ? firstError.selectedTool : undefined); }
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
  async generate(input: DesignProposalInput, context?: AiGenerationContext): Promise<BlogDesignSpecV2> {
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
