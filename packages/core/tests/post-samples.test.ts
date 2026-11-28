import { describe, expect, it } from 'vitest';
import { createPostSamples } from '../src/design/profile.js';
import type { Post } from '../src/types.js';

const post = (overrides: Partial<Post>): Post => ({
  id: '1',
  title: 'Post',
  content: '',
  slug: 'post',
  date: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('post samples for the designer', () => {
  it('keeps the newest posts first and caps how many it sends', () => {
    const posts = Array.from({ length: 15 }, (_, index) =>
      post({
        id: String(index),
        title: `Post ${String(index)}`,
        date: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    const samples = createPostSamples(posts);
    expect(samples).toHaveLength(12);
    expect(samples[0]?.title).toBe('Post 14');
  });
  it('turns Markdown into short prose without code, images, links or markup', () => {
    const [sample] = createPostSamples(
      [
        post({
          tags: ['tea', 'notes'],
          content: [
            '---',
            'title: hidden',
            '---',
            '# Brewing **green** tea',
            '',
            '![cup](cup.png) Use [a kettle](https://example.com) at 80°C.',
            '',
            '```js',
            'console.log("secret");',
            '```',
            '<div>Wait</div> three minutes.',
          ].join('\n'),
        }),
      ],
      12,
      60,
    );
    expect(sample).toEqual({
      title: 'Post',
      tags: ['tea', 'notes'],
      excerpt: 'Brewing green tea Use a kettle at 80°C. Wait three minutes.',
    });
  });
});
