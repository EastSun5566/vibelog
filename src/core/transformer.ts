import { AI_PROMPTS } from '../consts';
import type { AiProvider } from '../types';
import { logger } from './logger';

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
    logger.info('\nStyle Transformation Diff:');
    logger.info('------------------------');
    logger.info('Original length:', original.length);
    logger.info('Transformed length:', transformed.length);
    logger.info('------------------------\n');
  }

  async transform(originalCss: string): Promise<string> {
    logger.info('Style prompt:', this.stylePrompt);

    try {
      const prompt = `
Original CSS:
${originalCss}

Style Requirements:
${this.stylePrompt}

${AI_PROMPTS.STYLE_RULES}}
`;

      logger.info('Generating styles with AI...');
      const generatedCss = await this.provider.generate(prompt);
      logger.info('AI generation completed');

      const cleanedCss = this.cleanOutput(generatedCss);
      this.logStyleDiff(originalCss, cleanedCss);

      logger.info('Style transformation completed');
      return cleanedCss;
    } catch (error) {
      logger.error('Style transformation failed:', error);
      return originalCss;
    }
  }
}
