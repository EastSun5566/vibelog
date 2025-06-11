import { generateObject, type LanguageModelV1 } from 'ai';
// import { openai } from '@ai-sdk/openai';
// import { anthropic } from '@ai-sdk/anthropic';
import { createOllama } from 'ollama-ai-provider';
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

  constructor(providerName: string, modelName: string) {
    switch (providerName) {
    case 'openai':
      // this.model = openai(modelName);
      break;
    case 'anthropic':
      // this.model = anthropic(modelName);
      break;
    case 'ollama':
      this.model = createOllama()(modelName);
      break;
    case 'openrouter':
      this.model = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      })(modelName);
      break;
    default:
      throw new Error(`Unsupported provider: ${providerName}. Supported: openai, anthropic, ollama, openrouter`);
    }

    logger.info(`AI provider: ${providerName} (${modelName})`);
  }

  async generate(prompt: string) {
    if (!this.model) {
      throw new Error('AI model is not initialized. Check provider and model name.');
    }

    const { object } = await generateObject({
      model: this.model,
      mode: 'json',
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
