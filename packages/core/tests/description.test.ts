import { describe, expect, it } from 'vitest';
import { extractPostDescription } from '../src/description.js';

describe('extractPostDescription', () => {
  it('keeps readable inline text without Markdown syntax or link destinations', () => {
    const markdown = '這是 **可靠的**摘要，with [連結文字](https://example.com/private) and `inlineCode`。';

    expect(extractPostDescription(markdown, 'Fallback')).toBe('這是 可靠的摘要，with 連結文字 and inlineCode。');
  });

  it('skips non-paragraph blocks and images before the first useful root paragraph', () => {
    const markdown = [
      '![secret alt](https://images.example.com/private.png)',
      '',
      '# Heading',
      '',
      '<div>Raw HTML</div>',
      '',
      '> Quoted introduction',
      '',
      '- Listed introduction',
      '',
      '```ts',
      'const secret = true;',
      '```',
      '',
      'First **real** paragraph with [safe label](https://example.com/hidden).',
    ].join('\n');

    expect(extractPostDescription(markdown, 'Fallback')).toBe('First real paragraph with safe label.');
    expect(extractPostDescription('&lt;div&gt;Escaped raw HTML&lt;/div&gt;\n\nUseful after escaped HTML.', 'Fallback')).toBe('Useful after escaped HTML.');
    expect(extractPostDescription('Useful &lt;span&gt;inline&lt;/span&gt; text.', 'Fallback')).toBe('Useful inline text.');
  });

  it('ignores URL-only links and continues to the next paragraph', () => {
    const markdown = '<https://example.com/private>\n\nA useful paragraph.';

    expect(extractPostDescription(markdown, 'Fallback')).toBe('A useful paragraph.');
  });

  it('falls back to the normalized title when no useful paragraph exists', () => {
    const markdown = '![alt](https://example.com/image.png)\n\n```js\nconst value = 1;\n```';

    expect(extractPostDescription(markdown, '  Image-only   article  ')).toBe('Image-only article');
    expect(extractPostDescription(null as unknown as string, 'Parser failure')).toBe('Parser failure');
  });

  it('normalizes whitespace and truncates at 160 Unicode code points', () => {
    expect(extractPostDescription('第一行  \n第二行\t with   spaces', 'Fallback')).toBe('第一行 第二行 with spaces');

    const exact = `${'文'.repeat(158)}😀Z`;
    const long = `${exact}extra`;
    expect(Array.from(exact)).toHaveLength(160);
    expect(extractPostDescription(exact, 'Fallback')).toBe(exact);
    const truncated = extractPostDescription(long, 'Fallback');
    expect(Array.from(truncated)).toHaveLength(160);
    expect(truncated).toBe(`${'文'.repeat(158)}😀…`);
  });
});
