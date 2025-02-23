import { resolve, join } from 'node:path';
import { build } from 'astro';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import fs from 'fs-extra';
import matter from 'gray-matter';

import type { ContentProvider } from '../types';
import type { StyleTransformer } from './transformer';
import { generateSlug, slugify } from './utils';

export interface SiteBuilderOptions {
  tempDir: string
  outDir: string
}

export class SiteBuilder {
  private root: string;
  private outDir: string;

  constructor(
    options: SiteBuilderOptions,
    private contentProvider: ContentProvider,
    private transformer: StyleTransformer,
  ) {
    this.root = resolve(process.cwd(), options.tempDir);
    this.outDir = resolve(process.cwd(), options.outDir);
  }

  async prepare() {
    console.log('Starting build preparation...');
    console.log(`Creating directory structure in ${this.root}`);

    const templateDir = resolve(process.cwd(), 'template');
    await fs.copy(templateDir, this.root);
    console.log('Template structure copied');
  }


  private async transformStyles() {
    const cssPath = join(this.root, 'src/styles/global.css');
    const originalCss = await fs.readFile(cssPath, 'utf-8');
    const transformedCss = await this.transformer.transform(originalCss);
    await fs.writeFile(cssPath, transformedCss);
  }

  async build() {
    console.log('Starting build process...');

    try {
      console.log('Fetching content...');
      const { posts, author } = await this.contentProvider.getContents();
      console.log(`Found ${String(posts.length)} content items`);

      console.log('Writing blog posts...');
      for (const post of posts) {
        const title = post.title || 'Untitled';
        const excerpt = post.content
          .split('\n')
          .find(p => p.trim().length > 0) ?? '';
        const slug = post.slug || slugify(post.title) || generateSlug();

        const fileContent = matter.stringify(post.content, {
          title,
          description: excerpt.slice(0, 100),
          date: post.date || new Date().toISOString(),
          slug,
        });

        const filePath = join(this.root, 'src/content/blog', `${slug}.md`);
        await fs.writeFile(filePath, fileContent);
      }

      console.log('Writing author profile...');
      const authorContent = matter.stringify(author.bio, {
        name: author.name,
      });
      const authorPath = join(this.root, 'src/content', 'author.md');
      await fs.writeFile(authorPath, authorContent);

      // console.log('Starting style transformation...');
      // await this.transformStyles();

      console.log('Starting Blog build...');
      await build({
        root: this.root,
        outDir: this.outDir,
        site: 'https://example.com',
        integrations: [mdx(), sitemap()],
      });

      console.log('Build completed successfully!');
    } catch (error) {
      console.error('Build failed:', error);
      throw error;
    }
  }

  async cleanup() {
    console.log('Starting cleanup...');
    await fs.remove(this.root);
    console.log('Cleanup completed');
  }
}
