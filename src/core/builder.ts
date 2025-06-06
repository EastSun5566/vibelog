import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'astro';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import fs from 'fs-extra';
import matter from 'gray-matter';

import { generateSlug, slugify } from './utils';
import { logger } from './logger';
import type { ContentProvider } from '../types';
import type { StyleTransformer } from './transformer';
import type { StateManager, VibeState } from './state';

function findTemplateDir(): string {
  const templateDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../template',
  );
  if (!fs.existsSync(templateDir)) {
    throw new Error(`Template directory not found: ${templateDir}`);
  }

  return templateDir;
}

export interface DevBuilderOptions {
  tempDir: string
  contentProvider: ContentProvider
  styleTransformer: StyleTransformer
  stateManager: StateManager;
}

export class DevBuilder {
  private root: string;
  contentProvider: ContentProvider;
  styleTransformer: StyleTransformer;
  stateManager: StateManager;

  constructor(
    {
      tempDir,
      contentProvider,
      styleTransformer,
      stateManager,
    }: DevBuilderOptions,
  ) {
    this.root = resolve(process.cwd(), tempDir);
    this.contentProvider = contentProvider;
    this.styleTransformer = styleTransformer;
    this.stateManager = stateManager;
  }

  private async restoreLastCssState() {
    const lastCss = await this.stateManager.getLastCss();
    if (lastCss) {
      const cssPath = join(this.root, 'src/styles/global.css');
      await fs.writeFile(cssPath, lastCss);
      logger.info('Restored last CSS modifications');
    }
  }

  async prepare() {
    logger.info(`Creating directory structure in ${this.root}`);

    // clear old temp directory
    await fs.remove(this.root);

    const templateDir = findTemplateDir();
    await fs.copy(templateDir, this.root);
    logger.info('Template structure copied');

    // restore last CSS state
    await this.restoreLastCssState();
  }

  async fetchContent() {
    logger.info('Fetching content...');

    const [{ posts }, author] = await Promise.all([
      this.contentProvider.getPosts(),
      this.contentProvider.getAuthor(),
    ]);
    logger.info(`Found ${String(posts.length)} posts of author ${author.name}`);

    await fs.ensureDir(join(this.root, 'src/content/blog'));

    logger.info('Writing blog posts...');
    for (const post of posts) {
      const title = post.title || 'Untitled';
      const excerpt = post.content
        .split('\n')
        .find((line) => line.trim().length > 0) ?? '';
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
    const authorContent = matter.stringify(author.bio, {
      name: author.name,
    });
    const authorPath = join(this.root, 'src/content', 'author.md');
    await fs.writeFile(authorPath, authorContent);

    await this.stateManager.saveContentSnapshot(posts, author);
    logger.info('Content fetched and saved to state');
  }

  async cleanup() {
    logger.info('Cleaning up development environment...');
    try {
      await fs.remove(this.root);
      logger.info('Cleanup completed');
    } catch (error) {
      logger.warn('Cleanup warning:', error);
    }
  }
}
export function createDevBuilder(
  options: DevBuilderOptions,
): DevBuilder {
  return new DevBuilder(options);
}

export interface ProdBuilderOptions {
  outDir: string;
  site: string;
  stateManager: StateManager;
}
export class ProdBuilder {
  private tempDir: string;
  private outDir: string;
  private site: string;
  private stateManager: StateManager;

  constructor({
    outDir,
    site,
    stateManager,
  }: ProdBuilderOptions) {
    this.tempDir = resolve(process.cwd(), '.temp-build');
    this.outDir = resolve(process.cwd(), outDir);
    this.site = site;
    this.stateManager = stateManager;
  }

  async build() {
    logger.info('Starting production build...');

    try {
      const state = await this.stateManager.loadState();

      await this.prepare();
      await this.restoreFromState(state);
      await this.astroBuild();

      logger.info('Production build completed successfully!');

    } catch (error) {
      logger.error('Production build failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  private async prepare() {
    logger.info('Preparing build environment...');

    await fs.remove(this.tempDir);
    await fs.remove(this.outDir);

    const templateDir = findTemplateDir();
    await fs.copy(templateDir, this.tempDir);

    logger.info('Build environment prepared');
  }

  private async restoreFromState(state: VibeState) {
    logger.info('Restoring content and styles from state...');

    // restore css
    if (state.lastModifiedCss) {
      const cssPath = join(this.tempDir, 'src/styles/global.css');
      await fs.writeFile(cssPath, state.lastModifiedCss);
      logger.info('CSS styles restored');
    } else {
      logger.warn('No custom CSS found, using default styles');
    }

    // restore content snapshot
    if (state.contentSnapshot) {
      await this.restoreContent(state.contentSnapshot);
      logger.info('Content restored from snapshot');
    } else {
      throw new Error('No content snapshot found in state. Please run "vibelog dev" first.');
    }
  }

  private async restoreContent(contentSnapshot: NonNullable<VibeState['contentSnapshot']>) {
    const { posts, author } = contentSnapshot;

    await fs.ensureDir(join(this.tempDir, 'src/content/blog'));

    for (const post of posts) {
      const title = post.title || 'Untitled';
      const excerpt = post.content
        .split('\n')
        .find((line) => line.trim().length > 0) ?? '';
      const slug = post.slug || slugify(post.title) || generateSlug();

      const fileContent = matter.stringify(post.content, {
        title,
        description: excerpt.slice(0, 100),
        date: post.date || new Date().toISOString(),
        slug,
      });

      const filePath = join(this.tempDir, 'src/content/blog', `${slug}.md`);
      await fs.writeFile(filePath, fileContent);
    }

    const authorContent = matter.stringify(author.bio, {
      name: author.name,
    });
    const authorPath = join(this.tempDir, 'src/content', 'author.md');
    await fs.writeFile(authorPath, authorContent);
  }

  private async astroBuild() {
    logger.info('Building with Astro...');

    await build({
      root: this.tempDir,
      outDir: this.outDir,
      site: this.site,
      integrations: [
        mdx(),
        sitemap(),
      ],
      vite: {
        logLevel: 'warn',
      },
    });

    logger.info(`Site built to ${this.outDir}`);
  }

  private async cleanup() {
    try {
      await fs.remove(this.tempDir);
      logger.info('Build environment cleaned up');
    } catch (error) {
      logger.warn('Cleanup warning:', error);
    }
  }
}
export function createProdBuilder(
  options: ProdBuilderOptions,
): ProdBuilder {
  return new ProdBuilder(options);
}
