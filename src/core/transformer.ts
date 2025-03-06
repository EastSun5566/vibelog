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

  private generatePrompt(rootCss: string): string {
    return `
Transform these CSS variables while keeping their names intact:

${rootCss}

Style Requirements:
${this.stylePrompt}

${AI_PROMPTS.STYLE_RULES}
`;
  }

  async transform(originalCss: string): Promise<string> {
    logger.info('Style prompt:', this.stylePrompt);

    try {
      const rootMatch = /:root\s*{[^}]+}/.exec(originalCss);
      if (!rootMatch) {
        logger.error('No :root section found in original CSS');
        return originalCss;
      }

      logger.info('Generating styles with AI...');
      const prompt = this.generatePrompt(rootMatch[0]);
      const generatedCss = await this.provider.generate(prompt);
      logger.info('AI generation completed');

      const cleanedCss = this.cleanOutput(generatedCss);
      const transformedCss = originalCss.replace(rootMatch[0], cleanedCss);

      logger.info('Style transformation completed');
      return transformedCss;
    } catch (error) {
      logger.error('Style transformation failed:', error);
      return originalCss;
    }
  }
}
