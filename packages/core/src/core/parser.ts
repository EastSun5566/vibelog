import { parse } from 'postcss';
import { logger } from './logger';
import type { CssVariable } from '../types';

export class CssParser {
  extractVariables(css: string): CssVariable[] {
    const variables: CssVariable[] = [];

    try {
      const root = parse(css);

      root.walkRules(':root', (rule) => {
        rule.walkDecls((declaration) => {
          if (declaration.prop.startsWith('--')) {
            variables.push({
              name: declaration.prop,
              value: declaration.value,
            });
          }
        });
      });

      logger.info(`Total extracted variables: ${variables.length.toString()}`);
    } catch (error) {
      logger.error('PostCSS parsing failed:', error);
    }

    return variables;
  }

  updateVariables(css: string, updates: CssVariable[]): string {
    try {
      const root = parse(css);

      root.walkRules(':root', (rule) => {
        rule.walkDecls((declaration) => {
          if (declaration.prop.startsWith('--')) {
            const update = updates.find(({ name }) => name === declaration.prop);
            if (update) {
              declaration.value = update.value;
            }
          }
        });
      });

      return root.toString();
    } catch (error) {
      logger.error('PostCSS rebuild failed:', error);
      return css;
    }
  }
}
