import { generateObject, type LanguageModelV1 } from 'ai';
import { createOllama } from 'ollama-ai-provider';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';

import { AI_PROMPTS, AiProviderName } from '../../consts';
import type { AiProvider } from '../../types';
import { logger } from '../../core';

const cssTransformSchema = z.object({
  variables: z.array(z.object({
    name: z.string(),
    value: z.string(),
  })),
  description: z.string(),
});

export class VercelAiProvider implements AiProvider {
  readonly model: LanguageModelV1 | null = null;

  constructor(readonly providerName: AiProviderName, readonly modelId: string) {
    logger.info(`AI provider: ${providerName} (${modelId})`);

    switch (providerName) {
    case AiProviderName.OLLAMA:
      this.model = createOllama()(modelId);
      break;
    case AiProviderName.OPENAI:
      this.model = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      })(modelId);
      break;
    case AiProviderName.ANTHROPIC:
      this.model = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      })(modelId);
      break;
    case AiProviderName.GOOGLE:
      this.model = createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      })(modelId);
      break;
    case AiProviderName.OPENROUTER:
      this.model = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      })(modelId);
      break;
    default:
      throw new Error(`Unsupported AI provider: ${providerName as string}. Supported: ${Object.values(AiProviderName).join(', ')}`);
    }
  }

  async generate(prompt: string) {
    const { model } = this;
    if (!model) {
      throw new Error('AI model is not initialized. Check provider and model name.');
    }

    const { object } = await generateObject({
      model,
      ...(this.providerName === AiProviderName.OPENROUTER && { mode: 'json' }),
      schema: cssTransformSchema,
      messages: [
        {
          role: 'system',
          content: AI_PROMPTS.CSS_EXPERT,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.1,
    });

    return object;
  }
}
