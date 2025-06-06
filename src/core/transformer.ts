import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { AI_PROMPTS } from '../consts';
import type { AiProvider } from '../types';
import { CssParser, type CssVariable } from './parser';
import { logger } from './logger';

export interface CssTransformResult {
  variables: CssVariable[];
  themeDescription: string;
}

interface StyleTransformerOptions {
  aiProvider: AiProvider
}

export class StyleTransformer {
  private aiProvider: AiProvider;
  private cssParser: CssParser;

  constructor({
    aiProvider,
  }: StyleTransformerOptions) {
    this.aiProvider = aiProvider;
    this.cssParser = new CssParser();
  }

  private createPrompt(variables: CssVariable[], stylePrompt: string): string {
    const variablesList = variables
      .map(({ name, value }) => `${name}: ${value}`)
      .join('\n');

    return `
Transform these CSS variables while keeping their names intact:

${variablesList}

Style Requirements: ${stylePrompt}

${AI_PROMPTS.STYLE_RULES}

Return JSON with updated variables and theme description.
`;
  }

  private getSchema() {
    const CssTransform = z.object({
      variables: z.array(z.object({
        name: z.string(),
        value: z.string(),
      })),
      themeDescription: z.string(),
    });

    return zodToJsonSchema(CssTransform);
  }

  async transform({
    originalCss,
    stylePrompt = AI_PROMPTS.CSS_EXPERT,
  }: {
    originalCss: string
    stylePrompt?: string
  }): Promise<string> {
    logger.info('Style prompt:', stylePrompt);

    try {
      const variables = this.cssParser.extractVariables(originalCss);
      if (variables.length === 0) {
        logger.error('No CSS variables found in :root');
        return originalCss;
      }

      logger.info('Generating styles with AI...');
      const prompt = this.createPrompt(variables, stylePrompt);
      const schema = this.getSchema();
      const result = await this.aiProvider.generate<CssTransformResult>(
        prompt,
        schema,
      );

      logger.info('AI generation completed');
      logger.info('Theme description:', result.themeDescription);

      const updatedVariables: CssVariable[] = result.variables.map(({ name, value }) => ({
        name,
        value,
      }));
      const transformedCss = this.cssParser.updateVariables(originalCss, updatedVariables);

      logger.info('Style transformation completed');
      return transformedCss;
    } catch (error) {
      logger.error('Style transformation failed:', error);
      return originalCss;
    }
  }
}

export function createStyleTransformer({
  aiProvider,
}: StyleTransformerOptions): StyleTransformer {
  return new StyleTransformer({ aiProvider });
}
