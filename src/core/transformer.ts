import { AI_PROMPTS } from '../constants';
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

  private logStyleDiff(original: string, transformed: string) {
    console.log('\nStyle Transformation Diff:');
    console.log('------------------------');
    console.log('Original length:', original.length);
    console.log('Transformed length:', transformed.length);
    console.log('------------------------\n');
  }

  async transform(originalCss: string): Promise<string> {
    console.log('Style prompt:', this.stylePrompt);

    try {
      const prompt = `
Original CSS:
${originalCss}

Style Requirements:
${this.stylePrompt}

${AI_PROMPTS.STYLE_RULES}}
`;

      console.log('Generating styles with AI...');
      const generatedCss = await this.provider.generate(prompt);
      console.log('AI generation completed');

      const cleanedCss = this.cleanOutput(generatedCss);
      this.logStyleDiff(originalCss, cleanedCss);

      console.log('Style transformation completed');
      return cleanedCss;
    } catch (error) {
      console.error('Style transformation failed:', error);
      return originalCss;
    }
  }
}
