import { describe, expect, it } from 'vitest';
import { isDangerousMarkdownUrl, sanitizeMarkdown } from '../src/markdown.js';

describe('sanitizeMarkdown', () => {
  it('escapes raw HTML and neutralizes dangerous links without breaking blockquotes', () => {
    const output = sanitizeMarkdown('<script>alert(1)</script>\n[x](javascript:alert(1))\n\n> Quoted text\n\n> [!NOTE]\n> Alert text\n\n```html\n<div onclick="x">code</div>\n```');
    expect(output).toContain('&lt;script>alert(1)&lt;/script>');
    expect(output).toContain('about:blank#blocked-');
    expect(output).toContain('> Quoted text');
    expect(output).toContain('> [!NOTE]');
    expect(output).toContain('<div onclick="x">code</div>');
  });

  it.each([
    '`a < b; [example](javascript:literal)`',
    '``a < b and `ticks` ``',
    '~~~html\n<div>literal</div>\n[example](data:literal)\n~~~',
    '````html\n```\n<div>literal</div>\n````',
    '    <div>indented code</div>\n    [example](vbscript:literal)',
    '> ~~~html\n> <div>quoted code</div>\n> ~~~',
  ])('preserves code exactly: %s', (source) => {
    expect(sanitizeMarkdown(source)).toBe(source);
  });

  it('preserves ordinary comparisons and autolinks while escaping only HTML', () => {
    expect(sanitizeMarkdown('a < b; <https://example.com>; <em>literal</em>\0'))
      .toBe('a < b; <https://example.com>; &lt;em>literal&lt;/em>');
  });
});

describe('Markdown URL policy', () => {
  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', ' data:text/html,test', 'vbscript:msgbox(1)'])('blocks dangerous schemes: %s', (url) => {
    expect(isDangerousMarkdownUrl(url)).toBe(true);
  });

  it.each(['https://example.com', 'http://example.com', '/blog/post/', '#section', 'mailto:writer@example.com'])('retains normal links: %s', (url) => {
    expect(isDangerousMarkdownUrl(url)).toBe(false);
  });
});
