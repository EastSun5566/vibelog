import { Ollama } from 'ollama';

import { AI_PROMPTS } from '../../constants';
import type { AiProvider } from '../../types';

export class OllamaProvider implements AiProvider {
  private ai: Ollama;

  constructor(
    private model: string,
    private options?: {
      temperature?: number
      maxTokens?: number
    },
  ) {
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
