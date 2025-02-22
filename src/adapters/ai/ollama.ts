import { Ollama } from 'ollama'

import type { AiProvider } from '../../types'

export class OllamaProvider implements AiProvider {
  private ai: Ollama
  
  constructor(
    private model: string,
    private options?: {
      temperature?: number
      maxTokens?: number
    }
  ) {
    this.ai = new Ollama()
  }

  async generate(prompt: string): Promise<string> {
    try {
      const response = await this.ai.chat({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "You are a CSS expert. Generate clean, valid CSS code only. No explanations or comments."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        ...this.options
      })

      return response.message.content
    } catch (error) {
      console.error('AI generation failed:', error)
      throw error
    }
  }
}
