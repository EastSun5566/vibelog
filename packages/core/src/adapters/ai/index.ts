import {
  Type,
  createModels,
  createProvider,
  validateToolCall,
  type Api,
  type Context,
  type Model,
  type Models,
  type MutableModels,
  type ProviderEnv,
  type Tool,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { builtinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all';

import { AI_PROMPTS } from '../../consts.js';
import type { AiProvider, CssTransformResult } from '../../types.js';
import { logger } from '../../core/index.js';

const CSS_TRANSFORM_TOOL_NAME = 'submit_css_transform';
const OLLAMA_PROVIDER = 'ollama';
const OLLAMA_BASE_URL = 'http://localhost:11434/v1';

const cssTransformTool: Tool = {
  name: CSS_TRANSFORM_TOOL_NAME,
  description: 'Return the complete, validated CSS variable transformation result.',
  parameters: Type.Object({
    variables: Type.Array(Type.Object({
      name: Type.String({ description: 'The CSS variable name. It must remain unchanged.' }),
      value: Type.String({ description: 'The replacement CSS variable value.' }),
    }, { additionalProperties: false })),
    description: Type.String({
      description: 'A brief explanation of the resulting theme and design intent.',
    }),
  }, { additionalProperties: false }),
};

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
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
  };

  return createProvider({
    id: OLLAMA_PROVIDER,
    name: 'Ollama',
    baseUrl,
    auth: {
      apiKey: {
        name: 'Ollama',
        resolve: () => Promise.resolve({ auth: {} }),
      },
    },
    models: [model],
    api: openAICompletionsApi(),
  });
}

function defaultModels(provider: string, modelId: string): MutableModels {
  const models = provider === OLLAMA_PROVIDER ? createModels() : builtinModels();
  if (provider === OLLAMA_PROVIDER) models.setProvider(createOllamaProvider(modelId));
  return models;
}

function requestEnv(provider: string): ProviderEnv | undefined {
  const legacyGoogleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (provider === 'google' && !process.env.GEMINI_API_KEY && legacyGoogleKey) {
    return { GEMINI_API_KEY: legacyGoogleKey };
  }
  return undefined;
}

function safeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const secrets = Object.entries(process.env)
    .flatMap(([name, value]) => value && value.length >= 8 && /(?:token|secret|api.?key|password)/i.test(name) ? [value] : []);
  return secrets
    .reduce((output, secret) => output.replaceAll(secret, '[REDACTED]'), message)
    .replaceAll(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[REDACTED]')
    .slice(0, 500);
}

export function getAiProviderNames(): string[] {
  return [...getBuiltinProviders(), OLLAMA_PROVIDER];
}

export class PiAiProvider implements AiProvider {
  readonly model: Model<Api>;

  constructor(
    readonly name: string,
    readonly modelId: string,
    private readonly models: Models = defaultModels(name, modelId),
  ) {
    if (!getAiProviderNames().includes(name) && !models.getProvider(name)) {
      throw new Error(`Unsupported AI provider: ${name}`);
    }

    const model = models.getModel(name, modelId);
    if (!model) throw new Error(`Unknown AI model: ${name}@${modelId}`);
    this.model = model;
    logger.info(`AI provider: ${name} (${modelId})`);
  }

  async generate(prompt: string): Promise<CssTransformResult> {
    const context: Context = {
      systemPrompt: `${AI_PROMPTS.CSS_EXPERT}\n\nYou must call ${CSS_TRANSFORM_TOOL_NAME} exactly once. Do not answer with plain text.`,
      messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      tools: [cssTransformTool],
    };

    let response;
    try {
      response = await this.models.complete(this.model, context, {
        temperature: 0.1,
        env: requestEnv(this.name),
      });
    } catch (error) {
      throw new Error(`AI provider request failed: ${safeProviderError(error)}`);
    }

    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      throw new Error(`AI provider request failed: ${safeProviderError(response.errorMessage ?? response.stopReason)}`);
    }
    if (response.stopReason === 'length') {
      throw new Error('AI response exceeded the model output limit.');
    }

    const toolCalls = response.content.filter((block) => block.type === 'toolCall');
    if (response.stopReason !== 'toolUse' || toolCalls.length !== 1) {
      throw new Error(`AI must call ${CSS_TRANSFORM_TOOL_NAME} exactly once.`);
    }
    const [toolCall] = toolCalls;
    if (toolCall.name !== CSS_TRANSFORM_TOOL_NAME) {
      throw new Error(`AI called an unexpected tool: ${toolCall.name}`);
    }

    try {
      return validateToolCall([cssTransformTool], toolCall) as CssTransformResult;
    } catch {
      throw new Error(`AI returned invalid arguments for ${CSS_TRANSFORM_TOOL_NAME}.`);
    }
  }
}

export function createAiProvider(name: string, modelId: string): PiAiProvider {
  return new PiAiProvider(name, modelId);
}
