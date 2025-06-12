import { generateObject, type LanguageModelV1 } from 'ai';
import { createOllama } from 'ollama-ai-provider';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';

import { AI_PROMPTS } from '../../consts';
import type { AiProvider } from '../../types';
import { logger } from '../../core';

const cssTransformSchema = z.object({
  variables: z.array(z.object({
    name: z.string(),
    value: z.string(),
  })),
  themeDescription: z.string(),
});

export class VercelAiProvider implements AiProvider {
  private model: LanguageModelV1 | null = null;
  providerName: string;
  modelName: string;

  constructor(providerName: string, modelName: string) {
    this.providerName = providerName;
    this.modelName = modelName;
    logger.info(`AI provider: ${providerName} (${modelName})`);

    switch (providerName) {
    case 'ollama':
      this.model = createOllama()(modelName);
      break;
    case 'openai':
      this.model = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      })(modelName);
      break;
    case 'anthropic':
      this.model = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      })(modelName);
      break;
    case 'google':
      this.model = createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      })(modelName);
      break;
    case 'openrouter':
      this.model = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      })(modelName);
      break;
    default:
      throw new Error(`Unsupported provider: ${providerName}. Supported: openai, anthropic, ollama, openrouter`);
    }
  }

  async generate(prompt: string) {
    const { model } = this;
    if (!model) {
      throw new Error('AI model is not initialized. Check provider and model name.');
    }

    const { object } = await generateObject({
      model,
      ...(this.providerName === 'openrouter' && { mode: 'json' }),
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
