import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { build as astroBuild } from 'astro';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import fs from 'fs-extra';
import matter from 'gray-matter';

import { generateSlug, slugify } from './utils';
import { logger } from './logger';
import type { ContentSource } from '../types';
import { loadConfig } from './config';

async function findTemplateDir() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const templateDir = resolve(
    currentDir,
    basename(currentDir) === 'dist' ? '..' : '../..',
    'template',
  );
  if (!await fs.exists(templateDir)) {
    throw new Error(`Template directory not found: ${templateDir}`);
  }

  return templateDir;
}

export interface DevBuilderOptions {
  root: string;
  contentSource: ContentSource;
}
export class DevBuilder {
  readonly root: string;
  readonly vibelogDir: string;
  readonly contentSource: ContentSource;

  constructor({ root, contentSource }: DevBuilderOptions) {
    this.root = root;
    this.vibelogDir = resolve(process.cwd(), root, '.vibelog');
    this.contentSource = contentSource;
  }

  private async initVibelogDir() {
    const templateDir = await findTemplateDir();
    await fs.copy(templateDir, this.vibelogDir);

    logger.info('Installing deps...');
    execSync('npm install', {
      cwd: this.vibelogDir,
      stdio: 'inherit',
      timeout: 5 * 60 * 1000,
    });
    logger.info('Deps installed successfully');
  }

  async prepare() {
    if (await fs.exists(this.vibelogDir)) {
      logger.info('Using existing ".vibelog" directory');
      return;
    }

    logger.info('Initializing ".vibelog"...');
    await this.initVibelogDir();
  }

  async fetchContent() {
    logger.info(`Fetching ${this.contentSource.name} content...`);

    const [{ posts }, author] = await Promise.all([
      this.contentSource.getPosts(),
      this.contentSource.getAuthor(),
    ]);
    logger.info(`Found ${String(posts.length)} posts by ${author.name}`);

    const config = await loadConfig(this.root);
    const siteTitle = config.site.title ?? basename(resolve(process.cwd(), this.root));
    const siteDescription = config.site.description ?? author.bio;

    const configContent = `// Auto-generated site configuration
export const SITE_TITLE = ${JSON.stringify(siteTitle)};
export const SITE_DESCRIPTION = ${JSON.stringify(siteDescription)};
`;
    const configPath = join(this.vibelogDir, 'src', 'consts.ts');
    await fs.writeFile(configPath, configContent);

    const blogDir = join(this.vibelogDir, 'src', 'content', 'blog');
    await fs.ensureDir(blogDir);
    await fs.emptyDir(blogDir);

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

      const filePath = join(blogDir, `${slug}.md`);
      await fs.writeFile(filePath, fileContent);
    }

    logger.info('Writing author profile...');
    const authorContent = matter.stringify(author.bio, {
      name: author.name,
    });
    const authorPath = join(this.vibelogDir, 'src', 'content', 'author.md');
    await fs.writeFile(authorPath, authorContent);

    logger.info('Content updated successfully');
  }
}
export function createDevBuilder(options: DevBuilderOptions) {
  return new DevBuilder(options);
}

export interface BuildOptions {
  vibelogDir: string;
  outDir: string;
  site: string;
}
export async function buildFromVibelog({ vibelogDir, outDir, site }: BuildOptions) {
  logger.info('Starting production build...');

  if (!await fs.exists(vibelogDir)) {
    throw new Error('No ".vibelog" directory found. Please run "vibelog dev" first.');
  }

  logger.info('Building with Astro...');

  const tempOutDir = join(vibelogDir, 'dist');
  await astroBuild({
    root: vibelogDir,
    outDir: tempOutDir,
    site,
    integrations: [mdx(), sitemap()],
    vite: {
      logLevel: 'warn',
    },
  });

  const finalOutDir = resolve(outDir);
  await fs.remove(finalOutDir);
  await fs.copy(tempOutDir, finalOutDir);

  logger.info(`Production build completed in ${outDir}`);
}
