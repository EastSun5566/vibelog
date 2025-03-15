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

export interface BuilderOptions {
  tempDir: string
  outDir: string
  contentProvider: ContentProvider
  styleTransformer: StyleTransformer
}

interface BuildOptions {
  stylePrompt: string;
  skipStyleTransform?: boolean;
}

export class Builder {
  private root: string;
  private outDir: string;
  contentProvider: ContentProvider;
  styleTransformer: StyleTransformer;

  constructor(
    {
      tempDir,
      outDir,
      contentProvider,
      styleTransformer,
    }: BuilderOptions,
  ) {
    this.root = resolve(process.cwd(), tempDir);
    this.outDir = resolve(process.cwd(), outDir);
    this.contentProvider = contentProvider;
    this.styleTransformer = styleTransformer;
  }

  async prepare() {
    logger.info(`Creating directory structure in ${this.root}`);

    const templateDir = resolve(process.cwd(), 'template');
    await fs.copy(templateDir, this.root);
    logger.info('Template structure copied');
  }

  async fetchContent() {
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
  }

  private async transformStyles(stylePrompt: string) {
    logger.info('Starting style transformation...');

    const cssPath = join(this.root, 'src/styles/global.css');
    const originalCss = await fs.readFile(cssPath, 'utf-8');
    const transformedCss = await this.styleTransformer.transform({
      originalCss,
      stylePrompt,
    });
    await fs.writeFile(cssPath, transformedCss);
  }

  async build({
    stylePrompt,
    skipStyleTransform = false,
  }: BuildOptions) {
    logger.info('Starting build process...');
    await this.prepare();

    try {
      await this.fetchContent();

      if (!skipStyleTransform) {
        await this.transformStyles(stylePrompt);
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

export function createBuilder(
  options: BuilderOptions,
): Builder {
  return new Builder(options);
}
