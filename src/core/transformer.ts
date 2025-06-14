import { inspect } from 'node:util';

import { AI_PROMPTS } from '../consts';
import { CssParser } from './parser';
import { logger } from './logger';
import type { AiProvider, CssVariable } from '../types';

interface StyleTransformerOptions {
  aiProvider: AiProvider
}

export class StyleTransformer {
  readonly aiProvider: AiProvider;
  readonly cssParser: CssParser;

  constructor({
    aiProvider,
  }: StyleTransformerOptions) {
    this.aiProvider = aiProvider;
    this.cssParser = new CssParser();
  }

  private createPrompt(variables: CssVariable[], stylePrompt: string): string {
    return `Transform these CSS variables to match the theme: "${stylePrompt}"

Current variables:
${variables.map(({ name, value }) => `${name}: ${value}`).join('\n')}

Return JSON with updated variables and description.
`;
  }

  async transform({
    originalCss,
    stylePrompt = AI_PROMPTS.CSS_EXPERT,
  }: {
    originalCss: string
    stylePrompt?: string
  }): Promise<{
    transformedCss: string
    description: string
  }> {
    logger.info('Style prompt:', stylePrompt);

    try {
      const variables = this.cssParser.extractVariables(originalCss);
      if (variables.length === 0) {
        logger.error('No CSS variables found in :root');
        return {
          transformedCss: originalCss,
          description: '',
        };
      }

      logger.info(`Generating styles with ${this.aiProvider.modelId}...`);
      const prompt = this.createPrompt(variables, stylePrompt);
      const { variables: newVariables, description } = await this.aiProvider.generate(
        prompt,
      );

      logger.info('AI generation completed');
      logger.info('Style description:', description);

      const updates: CssVariable[] = newVariables.map(({ name, value }) => ({
        name,
        value,
      }));
      const transformedCss = this.cssParser.updateVariables(originalCss, updates);

      logger.info('Style transformation completed');
      return {
        transformedCss,
        description: description,
      };
    } catch (error) {
      logger.error('Style transformation failed:', inspect(error, { depth: null }));
      return {
        transformedCss: originalCss,
        description: '',
      };
    }
  }
}

export function createStyleTransformer({
  aiProvider,
}: StyleTransformerOptions): StyleTransformer {
  return new StyleTransformer({ aiProvider });
}
