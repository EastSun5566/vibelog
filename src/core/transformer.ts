import type { AiProvider } from '../types';

export class StyleTransformer {
  constructor(
    private stylePrompt: string,
    private provider: AiProvider,
  ) {}

  private cleanOutput(css: string): string {
    return css
      .replace(/```css/g, '')
      .replace(/```/g, '')
      .trim();
  }

  async transform(originalCss: string): Promise<string> {
    try {
      const prompt = `
Original CSS:
${originalCss}

Style Requirements:
${this.stylePrompt}

Rules:
1. Keep existing CSS structure
2. Use --theme- prefix for all new variables
3. Add dark theme support
4. Add subtle animations
5. Enhance interactive states

Return only valid CSS code.`;

      const generatedCss = await this.provider.generate(prompt);
      return this.cleanOutput(generatedCss);
    } catch (error) {
      console.error('Style transformation failed:', error);
      return originalCss;
    }
  }
}
