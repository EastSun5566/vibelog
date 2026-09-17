import { describe, expect, it } from 'vitest';
import { sanitizeMarkdown } from '../src/markdown.js';

describe('sanitizeMarkdown', () => {
  it('escapes raw HTML and neutralizes dangerous links without breaking blockquotes', () => {
    const output = sanitizeMarkdown('<script>alert(1)</script>\n[x](javascript:alert(1))\n\n> Quoted text\n\n> [!NOTE]\n> Alert text\n\n```html\n<div onclick="x">code</div>\n```');
    expect(output).toContain('&lt;script>alert(1)&lt;/script>');
    expect(output).toContain('about:blank#blocked-');
    expect(output).toContain('> Quoted text');
    expect(output).toContain('> [!NOTE]');
    expect(output).toContain('<div onclick="x">code</div>');
  });
});
