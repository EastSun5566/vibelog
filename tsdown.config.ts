import { defineConfig } from 'tsdown';

export default defineConfig(() => ({
  entry: ['src/cli/index.ts'],
  minify: true,
  external: [
    'astro',
    '@astrojs/mdx',
    '@astrojs/sitemap',
    '@astrojs/rss',
  ],
}));
