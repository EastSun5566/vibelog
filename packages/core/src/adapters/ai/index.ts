import assert from 'node:assert/strict';
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

const cssTransformSchema = z
  .object({
    variables: z
      .array(z
        .object({
          name: z
            .string()
            .describe('The name of the CSS variable, which must remain unchanged.'),
          value: z
            .string()
            .describe('The value of the CSS variable.'),
        })
        .describe('CSS variable map object'),
      )
      .describe('Array of CSS variables, each with a name and value.'),
    description: z
      .string()
      .describe('A brief description of the theme created or changed, explaining the design intent and any notable features.'),
  })
  .describe('Schema for CSS transformation result');

export class VercelAiProvider implements AiProvider {
  readonly model: LanguageModelV1 | null = null;

  constructor(readonly name: AiProviderName, readonly modelId: string) {
    logger.info(`AI provider: ${name} (${modelId})`);

    switch (name) {
    case AiProviderName.OLLAMA:
      this.model = createOllama()(modelId);
      break;
    case AiProviderName.OPENAI:
      assert(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY environment variable is required.');
      this.model = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      })(modelId);
      break;
    case AiProviderName.ANTHROPIC:
      assert(process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY environment variable is required.');
      this.model = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      })(modelId);
      break;
    case AiProviderName.GOOGLE:
      assert(process.env.GOOGLE_GENERATIVE_AI_API_KEY, 'GOOGLE_GENERATIVE_AI_API_KEY environment variable is required.');
      this.model = createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      })(modelId);
      break;
    case AiProviderName.OPENROUTER:
      assert(process.env.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY environment variable is required.');
      this.model = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      })(modelId);
      break;
    default:
      throw new Error(`Unsupported AI provider: ${name as string}. Supported: ${Object.values(AiProviderName).join(', ')}`);
    }
  }

  async generate(prompt: string) {
    const { model } = this;
    if (!model) {
      throw new Error('AI model is not initialized. Check provider and model name.');
    }

    const { object } = await generateObject({
      model,
      ...(this.name === AiProviderName.OPENROUTER && { mode: 'json' }),
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

/**
 * Type-safe factory function to create AI providers
 * For programmatic API usage
 */
export function createAiProvider(
  name: AiProviderName,
  modelId: string,
): VercelAiProvider {
  return new VercelAiProvider(name, modelId);
}
