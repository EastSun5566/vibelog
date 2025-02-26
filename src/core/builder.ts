import { resolve, join } from 'node:path';
import { build } from 'astro';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import fs from 'fs-extra';
import matter from 'gray-matter';

import { generateSlug, slugify } from './utils';
import { logger } from './logger';
import type { ContentProvider } from '../types';
import type { StyleTransformer } from './transformer';

export interface SiteBuilderOptions {
  tempDir: string
  outDir: string
}

interface BuildOptions {
  skipStyleTransform?: boolean
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
    logger.info(`Creating directory structure in ${this.root}`);

    const templateDir = resolve(process.cwd(), 'template');
    await fs.copy(templateDir, this.root);
    logger.info('Template structure copied');
  }


  private async transformStyles() {
    const cssPath = join(this.root, 'src/styles/global.css');
    const originalCss = await fs.readFile(cssPath, 'utf-8');
    const transformedCss = await this.transformer.transform(originalCss);
    await fs.writeFile(cssPath, transformedCss);
  }

  async build({
    skipStyleTransform = false,
  }: BuildOptions = {}) {
    logger.info('Starting build preparation...');
    await this.prepare();

    logger.info('Starting build process...');
    try {
      logger.info('Fetching content...');
      const [{ posts }, { name, bio }] = await Promise.all([
        this.contentProvider.getPosts(),
        this.contentProvider.getAuthor(),
      ]);
      logger.info(`Found ${String(posts.length)} posts of author ${name}`);

      logger.info('Writing blog posts...');
      for (const post of posts) {
        const title = post.title || 'Untitled';
        const excerpt = post.content
          .split('\n')
          .find(post => post.trim().length > 0) ?? '';
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

      logger.info('Writing author profile...');
      const authorContent = matter.stringify(bio, {
        name,
      });
      const authorPath = join(this.root, 'src/content', 'author.md');
      await fs.writeFile(authorPath, authorContent);

      if (!skipStyleTransform) {
        logger.info('Starting style transformation...');
        await this.transformStyles();
      }

      logger.info('Starting Blog build...');
      await build({
        root: this.root,
        outDir: this.outDir,
        site: 'https://vibe.eastsun.me',
        integrations: [mdx(), sitemap()],
      });

      logger.info('Build completed successfully!');
    } catch (error) {
      logger.error('Build failed:', error);
      throw error;
    }
  }

  async cleanup() {
    logger.info('Starting cleanup...');
    await fs.remove(this.root);
    logger.info('Cleanup completed');
  }
}
