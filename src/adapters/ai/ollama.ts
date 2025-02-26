import { Ollama } from 'ollama';

import { AI_PROMPTS } from '../../consts';
import type { AiProvider } from '../../types';
import { logger } from '../../core';

export class OllamaProvider implements AiProvider {
  private ai: Ollama;

  constructor(
    private model: string,
    private options?: {
      temperature?: number
      maxTokens?: number
    },
  ) {
    logger.info(`AI provider: Ollama (${model})`);
    this.ai = new Ollama();
  }

  async generate(prompt: string): Promise<string> {
    console.log('Generating with model:', this.model);

    try {
      const response = await this.ai.chat({
        model: this.model,
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
        ...this.options,
      });

      return response.message.content;
    } catch (error) {
      console.error('AI generation failed:', error);
      throw error;
    }
  }
}
