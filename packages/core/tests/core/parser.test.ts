import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CssParser } from '../../src/core/parser.js';
import type { CssVariable } from '../../src/types.js';

// Mock logger
vi.mock('../../src/core/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Parser', () => {
  let parser: CssParser;

  beforeEach(() => {
    parser = new CssParser();
    vi.clearAllMocks();
  });

  describe('CssParser', () => {
    describe('extractVariables', () => {
      it('should extract CSS variables from :root rule', () => {
        const css = `
          :root {
            --primary-color: #007acc;
            --secondary-color: #ff6b6b;
            --font-size: 16px;
          }
          
          .other-rule {
            color: var(--primary-color);
          }
        `;

        const variables = parser.extractVariables(css);

        expect(variables).toHaveLength(3);
        expect(variables).toEqual([
          { name: '--primary-color', value: '#007acc' },
          { name: '--secondary-color', value: '#ff6b6b' },
          { name: '--font-size', value: '16px' },
        ]);
      });

      it('should return empty array when no :root rule exists', () => {
        const css = `
          .container {
            color: red;
            background: blue;
          }
        `;

        const variables = parser.extractVariables(css);

        expect(variables).toHaveLength(0);
      });

      it('should ignore non-custom properties in :root', () => {
        const css = `
          :root {
            --custom-var: red;
            color: blue;
            font-size: 14px;
          }
        `;

        const variables = parser.extractVariables(css);

        expect(variables).toHaveLength(1);
        expect(variables[0]).toEqual({ name: '--custom-var', value: 'red' });
      });

      it('should handle multiple :root rules', () => {
        const css = `
          :root {
            --var1: value1;
          }
          
          :root {
            --var2: value2;
          }
        `;

        const variables = parser.extractVariables(css);

        expect(variables).toHaveLength(2);
        expect(variables).toContainEqual({ name: '--var1', value: 'value1' });
        expect(variables).toContainEqual({ name: '--var2', value: 'value2' });
      });

      it('should handle malformed CSS gracefully', () => {
        const malformedCss = ':root { --var: ; }';

        const variables = parser.extractVariables(malformedCss);

        expect(variables).toHaveLength(1);
        expect(variables[0]).toEqual({ name: '--var', value: ' ' });
      });

      it('should reject completely invalid CSS', () => {
        const invalidCss = 'this is not css at all {{{';

        expect(() => parser.extractVariables(invalidCss)).toThrow('Unclosed block');
      });
    });

    describe('updateVariables', () => {
      it('should update CSS variables in :root rule', () => {
        const originalCss = `
          :root {
            --primary-color: #007acc;
            --secondary-color: #ff6b6b;
          }
        `;

        const updates: CssVariable[] = [
          { name: '--primary-color', value: '#ff0000' },
          { name: '--secondary-color', value: '#00ff00' },
        ];

        const updatedCss = parser.updateVariables(originalCss, updates);

        expect(updatedCss).toContain('--primary-color: #ff0000');
        expect(updatedCss).toContain('--secondary-color: #00ff00');
      });

      it('should only update variables that exist in the original CSS', () => {
        const originalCss = `
          :root {
            --existing-var: old-value;
          }
        `;

        const updates: CssVariable[] = [
          { name: '--existing-var', value: 'new-value' },
          { name: '--non-existing-var', value: 'some-value' },
        ];

        const updatedCss = parser.updateVariables(originalCss, updates);

        expect(updatedCss).toContain('--existing-var: new-value');
        expect(updatedCss).not.toContain('--non-existing-var');
      });

      it('should preserve CSS structure and other rules', () => {
        const originalCss = `
          :root {
            --color: blue;
          }
          
          .container {
            color: var(--color);
            background: white;
          }
        `;

        const updates: CssVariable[] = [
          { name: '--color', value: 'red' },
        ];

        const updatedCss = parser.updateVariables(originalCss, updates);

        expect(updatedCss).toContain('--color: red');
        expect(updatedCss).toContain('.container');
        expect(updatedCss).toContain('color: var(--color)');
        expect(updatedCss).toContain('background: white');
      });

      it('should return original CSS when no updates match', () => {
        const originalCss = ':root { --var1: value1; }';
        const updates: CssVariable[] = [
          { name: '--var2', value: 'value2' },
        ];

        const updatedCss = parser.updateVariables(originalCss, updates);

        expect(updatedCss).toContain('--var1: value1');
      });

      it('should reject invalid CSS', () => {
        const invalidCss = 'this is not css {{{';
        const updates: CssVariable[] = [
          { name: '--var', value: 'value' },
        ];

        expect(() => parser.updateVariables(invalidCss, updates)).toThrow('Unclosed block');
      });
    });
  });
});
