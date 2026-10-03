import { describe, expect, it } from 'vitest';
import { parseFrontMatter, stringifyFrontMatter } from '../src/core/frontmatter.js';

describe('content front matter', () => {
  it.each(['js', 'javascript', 'JS', 'JavaScript'])('rejects %s in parsing and serialization', (language) => {
    const input = `---${language}\n({ title: 'Not data' })\n---\nArticle body`;
    expect(() => parseFrontMatter(input)).toThrow('JavaScript front matter is not supported');
    expect(() => stringifyFrontMatter(input, { title: 'Writer title' })).toThrow('JavaScript front matter is not supported');
  });

  it.each([
    ['yaml', 'title: Original\ncustom: retained'],
    ['yml', 'title: Original\ncustom: retained'],
    ['json', '{ "title": "Original", "custom": "retained" }'],
  ])('retains %s data and Markdown while generated metadata takes precedence', (language, data) => {
    const input = `---${language}\n${data}\n---\n## Article\n\nBody.\n`;
    const parsed = parseFrontMatter(input);
    expect(parsed.data).toEqual({ title: 'Original', custom: 'retained' });
    const generated = stringifyFrontMatter(input, { title: 'Writer title' });
    expect(generated).toContain('Writer title');
    expect(generated).toContain('retained');
    expect(generated).toContain(parsed.content);
    expect(generated).not.toContain('Original');
  });
});
