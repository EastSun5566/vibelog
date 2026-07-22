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

import { extractPostDescription } from '../description.js';
import { generateSlug, slugify } from './utils.js';
import { logger } from './logger.js';
import type { ContentSource } from '../types.js';
import { loadConfig } from './config.js';

const TEMPLATE_VERSION = 4;
const postSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  content: z.string(),
  slug: z.string(),
  date: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid post date'),
  tags: z.array(z.string()).optional().default([]),
  updatedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid post modified date').optional(),
});

function normalizeTagName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function tagKey(value: string): string {
  return value.toLocaleLowerCase('und');
}

function tagHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function normalizePostTags(posts: z.infer<typeof postSchema>[]): BuildPostTag[][] {
  const displayNames = new Map<string, string>();
  const postKeys: string[][] = [];
  for (const post of posts) {
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const rawTag of post.tags) {
      const name = normalizeTagName(rawTag);
      if (!name) continue;
      const key = tagKey(name);
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
      if (!displayNames.has(key)) displayNames.set(key, name);
    }
    postKeys.push(keys);
  }

  const keysByBaseSlug = new Map<string, string[]>();
  for (const [key, name] of displayNames) {
    const baseSlug = slugify(name);
    const keys = keysByBaseSlug.get(baseSlug) ?? [];
    keys.push(key);
    keysByBaseSlug.set(baseSlug, keys);
  }
  const tagsByKey = new Map<string, BuildPostTag>();
  for (const [key, name] of displayNames) {
    const baseSlug = slugify(name);
    const collides = (keysByBaseSlug.get(baseSlug)?.length ?? 0) > 1;
    const slug = !baseSlug || collides ? `${baseSlug || 'tag'}-${tagHash(key)}` : baseSlug;
    tagsByKey.set(key, { name, slug });
  }

  return postKeys.map((keys) => keys
    .map((key) => tagsByKey.get(key))
    .filter((tag): tag is BuildPostTag => Boolean(tag))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant')));
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
export interface BuildPostSummary {
  title: string;
  slug: string;
  publishedAt: string;
  included: boolean;
  tags: BuildPostTag[];
  updatedAt?: string;
}
export interface BuildPostTag { name: string; slug: string }
export interface BuildContentSummary {
  author: { name: string; bio: string };
  posts: BuildPostSummary[];
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

  async fetchContent({ excludedSlugs = [] }: { excludedSlugs?: Iterable<string> } = {}): Promise<BuildContentSummary> {
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
    const siteLanguage = config.site.language ?? 'zh-Hant';

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

    const excluded = new Set(excludedSlugs);
    const usedSlugs = new Set<string>();
    const tagsByPost = normalizePostTags(posts);
    const normalizedPosts = posts.map((post, index) => {
      const title = post.title || 'Untitled';
      const baseSlug = slugify(post.slug) || slugify(post.title) || slugify(post.id) || generateSlug();
      const slug = baseSlug;
      if (usedSlugs.has(slug)) throw new Error(`Duplicate post slug after normalization: ${slug}`);
      usedSlugs.add(slug);
      const publishedAt = new Date(post.date).toISOString();
      let updatedAt: string | undefined;
      if (post.updatedAt) {
        const modified = new Date(post.updatedAt);
        if (modified.getTime() > new Date(publishedAt).getTime()) updatedAt = modified.toISOString();
      }
      return {
        ...post,
        title,
        slug,
        publishedAt,
        tags: tagsByPost[index] ?? [],
        ...(updatedAt ? { updatedAt } : {}),
        included: !excluded.has(slug),
      };
    });
    if (!normalizedPosts.some((post) => post.included)) throw new Error('No articles selected');

    logger.info('Writing selected blog posts...');
    for (const post of normalizedPosts) {
      if (!post.included) continue;
      const fileContent = matter.stringify(post.content, {
        title: post.title,
        description: extractPostDescription(post.content, post.title),
        date: post.publishedAt,
        slug: post.slug,
        ...(post.updatedAt ? { updatedDate: post.updatedAt } : {}),
        tags: post.tags,
      });

      const filePath = join(blogDir, `${post.slug}.md`);
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
    return {
      author,
      posts: normalizedPosts
        .map(({ title, slug, publishedAt, included, tags, updatedAt }) => ({
          title,
          slug,
          publishedAt,
          included,
          tags,
          ...(updatedAt ? { updatedAt } : {}),
        }))
        .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt) || left.slug.localeCompare(right.slug)),
    };
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
    throw new Error('The generated Astro draft is missing. Sync the HackMD content first.');
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
