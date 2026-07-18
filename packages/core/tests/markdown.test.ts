import { describe, expect, it } from 'vitest';
import { sanitizeMarkdown } from '../src/markdown.js';

describe('sanitizeMarkdown', () => {
  it('escapes raw HTML and neutralizes dangerous links outside code fences', () => {
    const output = sanitizeMarkdown('<script>alert(1)</script>\n[x](javascript:alert(1))\n```html\n<div onclick="x">code</div>\n```');
    expect(output).toContain('&lt;script&gt;');
    expect(output).toContain('about:blank#blocked-');
    expect(output).toContain('<div onclick="x">code</div>');
  });
});
