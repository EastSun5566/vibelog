import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, dirname, basename, isAbsolute, relative, sep, parse as parsePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build as astroBuild } from 'astro';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import fs from 'fs-extra';
import matter from 'gray-matter';
import { z } from 'zod';

import { generateSlug, slugify } from './utils';
import { logger } from './logger';
import type { ContentSource } from '../types';
import { loadConfig } from './config';

const TEMPLATE_VERSION = 1;
const postSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  content: z.string(),
  slug: z.string(),
  date: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid post date'),
});

function stableSuffix(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function isPathInside(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot !== '' && !pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot);
}

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
  baseDir?: string;
}
export class DevBuilder {
  readonly root: string;
  readonly vibelogDir: string;
  readonly contentSource: ContentSource;

  constructor({ root, contentSource, baseDir = process.cwd() }: DevBuilderOptions) {
    this.root = resolve(baseDir, root);
    this.vibelogDir = resolve(this.root, '.vibelog');
    this.contentSource = contentSource;
  }

  private async ensurePackagedRuntime(directory: string): Promise<void> {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const packageRoot = basename(currentDir) === 'dist' ? dirname(currentDir) : resolve(currentDir, '../..');
    const directNodeModules = join(packageRoot, 'node_modules');
    const runtimeNodeModules = await fs.exists(join(directNodeModules, '@astrojs', 'rss'))
      ? directNodeModules
      : resolve(packageRoot, '../..');
    for (const requiredPackage of [join('astro', 'package.json'), join('@astrojs', 'rss', 'package.json')]) {
      if (!await fs.exists(join(runtimeNodeModules, requiredPackage))) {
        throw new Error(`Packaged template runtime is incomplete: ${requiredPackage}`);
      }
    }
    const runtimeLink = join(directory, 'node_modules');
    if (!await fs.exists(runtimeLink)) {
      await fs.ensureSymlink(runtimeNodeModules, runtimeLink, 'junction');
    }
  }

  private async initVibelogDir({ installDependencies }: { installDependencies: boolean }) {
    const templateDir = await findTemplateDir();
    await fs.ensureDir(this.root);
    const stagingDir = join(this.root, `.vibelog-staging-${randomUUID()}`);
    const backupDir = join(this.root, `.vibelog-backup-${randomUUID()}`);
    await fs.copy(templateDir, stagingDir);

    const currentCss = join(this.vibelogDir, 'src', 'styles', 'global.css');
    if (await fs.exists(currentCss)) {
      await fs.copy(currentCss, join(stagingDir, 'src', 'styles', 'global.css'));
    }
    await fs.writeJson(join(stagingDir, '.vibelog-state.json'), { templateVersion: TEMPLATE_VERSION });

    if (installDependencies) {
      logger.info('Installing template dependencies...');
      execFileSync('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: stagingDir,
        stdio: 'inherit',
        timeout: 5 * 60 * 1000,
      });
      logger.info('Template dependencies installed successfully');
    } else {
      await this.ensurePackagedRuntime(stagingDir);
    }

    const hadExisting = await fs.exists(this.vibelogDir);
    if (hadExisting) await fs.move(this.vibelogDir, backupDir);
    try {
      await fs.move(stagingDir, this.vibelogDir);
      if (hadExisting) await fs.remove(backupDir);
    } catch (error) {
      await fs.remove(stagingDir);
      if (hadExisting && await fs.exists(backupDir)) await fs.move(backupDir, this.vibelogDir);
      throw error;
    }
  }

  async prepare(options: { installDependencies?: boolean } = {}) {
    const installDependencies = options.installDependencies ?? true;
    if (await fs.exists(this.vibelogDir)) {
      const statePath = join(this.vibelogDir, '.vibelog-state.json');
      const state = await fs.readJson(statePath).catch(() => null) as { templateVersion?: number } | null;
      if (state?.templateVersion === TEMPLATE_VERSION) {
        if (!installDependencies) await this.ensurePackagedRuntime(this.vibelogDir);
        logger.info('Using current ".vibelog" directory');
        return;
      }
      logger.info('Upgrading generated VibeLog template...');
    } else {
      logger.info('Initializing ".vibelog"...');
    }

    await this.initVibelogDir({ installDependencies });
  }

  async fetchContent() {
    logger.info(`Fetching ${this.contentSource.name} content...`);

    const [{ posts: rawPosts }, author] = await Promise.all([
      this.contentSource.getPosts(),
      this.contentSource.getAuthor(),
    ]);
    const posts = z.array(postSchema).parse(rawPosts);
    if (!author.name || typeof author.bio !== 'string') {
      throw new Error('Content source returned an invalid author');
    }
    logger.info(`Found ${String(posts.length)} posts by ${author.name}`);

    const config = await loadConfig(this.root);
    const siteTitle = config.site.title ?? basename(this.root);
    const siteDescription = config.site.description ?? author.bio;
    const siteLanguage = config.site.language ?? 'en';

    const configContent = `// Auto-generated site configuration
export const SITE_TITLE = ${JSON.stringify(siteTitle)};
export const SITE_DESCRIPTION = ${JSON.stringify(siteDescription)};
export const SITE_LANGUAGE = ${JSON.stringify(siteLanguage)};
`;
    const configPath = join(this.vibelogDir, 'src', 'consts.ts');
    const configStagingPath = `${configPath}.${randomUUID()}.tmp`;
    const configBackupPath = `${configPath}.${randomUUID()}.backup`;
    await fs.writeFile(configStagingPath, configContent);

    const sourceDir = join(this.vibelogDir, 'src');
    const contentDir = join(sourceDir, 'content');
    const stagedContentDir = join(sourceDir, `.content-staging-${randomUUID()}`);
    const backupContentDir = join(sourceDir, `.content-backup-${randomUUID()}`);
    const blogDir = join(stagedContentDir, 'blog');
    await fs.ensureDir(blogDir);

    logger.info('Writing blog posts...');
    const usedSlugs = new Set<string>();
    for (const post of posts) {
      const title = post.title || 'Untitled';
      const excerpt = post.content
        .split('\n')
        .find((line) => line.trim().length > 0) ?? '';
      const baseSlug = slugify(post.slug) || slugify(post.title) || slugify(post.id) || generateSlug();
      const slug = usedSlugs.has(baseSlug) ? `${baseSlug}-${stableSuffix(post.id)}` : baseSlug;
      if (usedSlugs.has(slug)) {
        throw new Error(`Duplicate post slug after normalization: ${slug}`);
      }
      usedSlugs.add(slug);

      const fileContent = matter.stringify(post.content, {
        title,
        description: excerpt.slice(0, 100),
        date: new Date(post.date).toISOString(),
        slug,
      });

      const filePath = join(blogDir, `${slug}.md`);
      await fs.writeFile(filePath, fileContent);
    }

    logger.info('Writing author profile...');
    const authorContent = matter.stringify(author.bio, {
      name: author.name,
    });
    const authorPath = join(stagedContentDir, 'author.md');
    await fs.writeFile(authorPath, authorContent);

    const hadContent = await fs.exists(contentDir);
    const hadConfig = await fs.exists(configPath);
    let contentBackedUp = false;
    let configBackedUp = false;
    let newContentInstalled = false;
    let newConfigInstalled = false;
    try {
      if (hadContent) {
        await fs.move(contentDir, backupContentDir);
        contentBackedUp = true;
      }
      if (hadConfig) {
        await fs.move(configPath, configBackupPath);
        configBackedUp = true;
      }
      await fs.move(stagedContentDir, contentDir);
      newContentInstalled = true;
      await fs.move(configStagingPath, configPath);
      newConfigInstalled = true;
    } catch (error) {
      if (newContentInstalled) await fs.remove(contentDir);
      if (newConfigInstalled) await fs.remove(configPath);
      await fs.remove(stagedContentDir);
      await fs.remove(configStagingPath);
      if (contentBackedUp && await fs.exists(backupContentDir)) await fs.move(backupContentDir, contentDir);
      if (configBackedUp && await fs.exists(configBackupPath)) await fs.move(configBackupPath, configPath);
      throw error;
    }
    if (contentBackedUp) await fs.remove(backupContentDir);
    if (configBackedUp) await fs.remove(configBackupPath);

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

  const siteUrl = new URL(site);
  if (!['http:', 'https:'].includes(siteUrl.protocol)) {
    throw new Error('Site URL must use http or https');
  }

  const resolvedVibelogDir = resolve(vibelogDir);
  const projectRoot = dirname(resolvedVibelogDir);
  const finalOutDir = resolve(outDir);
  if (
    finalOutDir === parsePath(finalOutDir).root
    || finalOutDir === projectRoot
    || finalOutDir === resolvedVibelogDir
    || isPathInside(resolvedVibelogDir, finalOutDir)
    || !isPathInside(projectRoot, finalOutDir)
  ) {
    throw new Error('Build output must be a safe directory inside the project root');
  }

  logger.info('Building with Astro...');

  // Keep prerender chunks below the generated runtime so Node can resolve
  // externalized template dependencies through .vibelog/node_modules.
  const tempOutDir = join(resolvedVibelogDir, `.build-staging-${randomUUID()}`);
  const backupOutDir = `${finalOutDir}.vibelog-backup-${randomUUID()}`;
  const previousWorkingDirectory = process.cwd();
  try {
    // Astro writes prerender chunks below process.cwd() when the project lives
    // elsewhere. Keeping cwd inside the generated project also keeps module
    // resolution inside the pinned, offline template runtime.
    process.chdir(resolvedVibelogDir);
    await astroBuild({
      root: resolvedVibelogDir,
      cacheDir: join(resolvedVibelogDir, '.astro'),
      outDir: tempOutDir,
      site: siteUrl.href,
      integrations: [mdx(), sitemap()],
      vite: {
        logLevel: 'warn',
      },
    });
  } catch (error) {
    await fs.remove(tempOutDir);
    throw error;
  } finally {
    process.chdir(previousWorkingDirectory);
  }

  const hadOutput = await fs.exists(finalOutDir);
  if (hadOutput) await fs.move(finalOutDir, backupOutDir);
  try {
    await fs.move(tempOutDir, finalOutDir);
    if (hadOutput) await fs.remove(backupOutDir);
  } catch (error) {
    await fs.remove(tempOutDir);
    await fs.remove(finalOutDir);
    if (hadOutput && await fs.exists(backupOutDir)) {
      await fs.move(backupOutDir, finalOutDir);
    }
    throw error;
  }

  logger.info(`Production build completed in ${outDir}`);
}
