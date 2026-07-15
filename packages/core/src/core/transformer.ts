import { AI_PROMPTS } from '../consts.js';
import { CssParser } from './parser.js';
import { logger } from './logger.js';
import type { AiProvider, CssVariable } from '../types.js';

export interface StyleTransformerOptions {
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
`;
  }

  private validateUpdates(original: CssVariable[], updates: CssVariable[]): CssVariable[] {
    const originalNames = new Set(original.map(({ name }) => name));
    const seen = new Set<string>();
    for (const update of updates) {
      if (!originalNames.has(update.name) || seen.has(update.name)) {
        throw new Error(`AI returned an unknown or duplicate CSS variable: ${update.name}`);
      }
      const hasControlCharacter = Array.from(update.value)
        .some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
      if (/[;{}@]|url\s*\(/i.test(update.value) || hasControlCharacter) {
        throw new Error(`AI returned an unsafe value for ${update.name}`);
      }
      seen.add(update.name);
    }
    return updates;
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

    const variables = this.cssParser.extractVariables(originalCss);
    if (variables.length === 0) {
      throw new Error('No CSS variables found in :root');
    }

    logger.info(`Generating styles with ${this.aiProvider.modelId}...`);
    const prompt = this.createPrompt(variables, stylePrompt);
    const { variables: newVariables, description } = await this.aiProvider.generate(prompt);

    logger.info('AI generation completed');
    logger.info('Response:', description);

    const updates = this.validateUpdates(variables, newVariables.map(({ name, value }) => ({
      name,
      value,
    })));
    const transformedCss = this.cssParser.updateVariables(originalCss, updates);
    this.cssParser.extractVariables(transformedCss);

    logger.info('Style transformation completed');
    return { transformedCss, description };
  }
}

export function createStyleTransformer({
  aiProvider,
}: StyleTransformerOptions): StyleTransformer {
  return new StyleTransformer({ aiProvider });
}
