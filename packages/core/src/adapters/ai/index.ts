import { Type, createModels, createProvider, validateToolCall, type Api, type Context, type Model, type Models, type MutableModels, type ProviderEnv, type ProviderStreams, type SimpleStreamOptions, type Tool } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { builtinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all';
import type { AiProvider, ThemeConfig, ThemeProposalInput } from '../../types.js';
import { validateThemeConfig } from '../../theme.js';
import { logger } from '../../core/index.js';

const THEME_TOOL_NAME = 'propose_theme';
const OLLAMA_PROVIDER = 'ollama';
const OLLAMA_BASE_URL = 'http://localhost:11434/v1';
const KEYLESS_OLLAMA_TRANSPORT_KEY = 'ollama-local';
const enumType = <T extends string>(values: readonly T[]) => Type.Union(values.map((value) => Type.Literal(value)));
const themeTool: Tool = {
  name: THEME_TOOL_NAME,
  description: 'Propose one complete VibeLog theme using only supported design tokens.',
  parameters: Type.Object({
    preset: enumType(['minimal', 'editorial', 'notebook']), appearance: enumType(['light', 'dark']),
    colors: Type.Object({ background: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), surface: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), text: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), muted: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), accent: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), border: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }) }, { additionalProperties: false }),
    bodyFont: enumType(['system-sans', 'system-serif']), headingFont: enumType(['system-sans', 'system-serif', 'system-mono']),
    scale: enumType(['compact', 'comfortable', 'large']), contentWidth: enumType(['narrow', 'medium', 'wide']), density: enumType(['compact', 'comfortable']), radius: enumType(['none', 'soft', 'round']),
    headerStyle: enumType(['compact', 'centered']), postListStyle: enumType(['divided', 'cards', 'numbered']), codeBlockStyle: enumType(['plain', 'panel']),
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
function defaultModels(provider: string, modelId: string): MutableModels { const models = provider === OLLAMA_PROVIDER ? createModels() : builtinModels(); if (provider === OLLAMA_PROVIDER) models.setProvider(createOllamaProvider(modelId)); return models; }
function requestEnv(provider: string): ProviderEnv | undefined { const legacy = process.env.GOOGLE_GENERATIVE_AI_API_KEY; return provider === 'google' && !process.env.GEMINI_API_KEY && legacy ? { GEMINI_API_KEY: legacy } : undefined; }
function safeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const secrets = Object.entries(process.env).flatMap(([name, value]) => value && value.length >= 8 && /(?:token|secret|api.?key|password)/i.test(name) ? [value] : []);
  return secrets.reduce((output, secret) => output.replaceAll(secret, '[REDACTED]'), message).replaceAll(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[REDACTED]').slice(0, 500);
}
export function getAiProviderNames(): string[] { return [...getBuiltinProviders(), OLLAMA_PROVIDER]; }

export class PiAiProvider implements AiProvider {
  readonly model: Model<Api>;
  constructor(readonly name: string, readonly modelId: string, private readonly models: Models = defaultModels(name, modelId)) {
    if (!getAiProviderNames().includes(name) && !models.getProvider(name)) throw new Error(`Unsupported AI provider: ${name}`);
    const model = models.getModel(name, modelId);
    if (!model) throw new Error(`Unknown AI model: ${name}@${modelId}`);
    this.model = model;
    logger.info(`AI provider: ${name} (${modelId})`);
  }
  private async generateOnce(input: ThemeProposalInput, previousError?: string): Promise<ThemeConfig> {
    const context: Context = {
      systemPrompt: `You are VibeLog's theme designer. Call ${THEME_TOOL_NAME} exactly once with a complete theme, including headerStyle, postListStyle, and codeBlockStyle. Never return CSS, HTML, fonts, URLs, or plain text. Ensure text and accent colors each have WCAG AA contrast against the background.${previousError ? ` Previous proposal error: ${previousError}. Correct it.` : ''}`,
      messages: [{ role: 'user', content: JSON.stringify(input), timestamp: Date.now() }], tools: [themeTool],
    };
    let response;
    try { response = await this.models.complete(this.model, context, { temperature: 0.2, env: requestEnv(this.name) }); }
    catch (error) { throw new Error(`AI provider request failed: ${safeProviderError(error)}`); }
    if (response.stopReason === 'error' || response.stopReason === 'aborted') throw new Error(`AI provider request failed: ${safeProviderError(response.errorMessage ?? response.stopReason)}`);
    if (response.stopReason === 'length') throw new Error('AI response exceeded the model output limit.');
    const toolCalls = response.content.filter((block) => block.type === 'toolCall');
    if (response.stopReason !== 'toolUse' || toolCalls.length !== 1) throw new Error(`AI must call ${THEME_TOOL_NAME} exactly once.`);
    const [toolCall] = toolCalls;
    if (toolCall.name !== THEME_TOOL_NAME) throw new Error(`AI called an unexpected tool: ${toolCall.name}`);
    let candidate: unknown;
    try { candidate = validateToolCall([themeTool], toolCall); }
    catch { throw new Error(`AI returned invalid arguments for ${THEME_TOOL_NAME}.`); }
    return validateThemeConfig(candidate);
  }
  async generate(input: ThemeProposalInput): Promise<ThemeConfig> {
    try { return await this.generateOnce(input); }
    catch (firstError) {
      if (firstError instanceof Error && (firstError.message.startsWith('AI provider request failed:') || firstError.message === 'AI response exceeded the model output limit.')) throw firstError;
      try { return await this.generateOnce(input, safeProviderError(firstError)); }
      catch { throw new Error('AI could not create a safe theme. Your current design was not changed.'); }
    }
  }
}
export function createAiProvider(name: string, modelId: string): PiAiProvider { return new PiAiProvider(name, modelId); }
