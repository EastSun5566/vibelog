import { Ollama, type Options } from 'ollama';

import { AI_PROMPTS } from '../../consts';
import type { AiProvider } from '../../types';
import { logger } from '../../core';

export class OllamaProvider implements AiProvider {
  private ai: Ollama;

  constructor(
    private model: string,
    private options?: Partial<Options>,
  ) {
    logger.info(`AI provider: Ollama (${model})`);
    this.ai = new Ollama();
  }

  async generate<T>(prompt: string, schema: object): Promise<T> {
    logger.info('Generating structured output with model:', this.model);

    try {
      const response = await this.ai.chat({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: AI_PROMPTS.CSS_EXPERT + '\n\nRespond with valid JSON only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        format: schema,
        options: {
          temperature: 0.1,
          ...this.options,
        },
      });

      return JSON.parse(response.message.content) as T;
    } catch (error) {
      logger.error('AI generation failed:', error);
      throw error;
    }
  }

}
