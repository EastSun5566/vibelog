import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join, resolve } from 'node:path';
import fs from 'fs-extra';
import { tmpdir } from 'node:os';
import { FsSource } from '../../src/adapters/content/fs';
import { DevBuilder, buildFromVibelog } from '../../src/core/builder';

describe('End-to-End Flow', () => {
  let testRoot: string;
  const fixtureContentDir = resolve(__dirname, '../fixtures/content');

  beforeEach(async () => {
    // Create a temporary directory for each test
    testRoot = await fs.mkdtemp(join(tmpdir(), 'vibelog-e2e-'));
  });

  afterEach(async () => {
    // Clean up temporary directory
    if (testRoot) {
      await fs.rm(testRoot, { recursive: true, force: true });
    }
  });

  it('should complete the full workflow from content to production build', async () => {
    // Step 1: Create a content source from fixtures
    const contentSource = new FsSource(fixtureContentDir);

    // Verify content source can fetch posts and author
    const { posts } = await contentSource.getPosts();
    const author = await contentSource.getAuthor();

    expect(posts).toHaveLength(2);
    expect(posts[0].title).toBe('First Test Post');
    expect(posts[1].title).toBe('Second Test Post');
    expect(author.name).toBe('Test Author');

    // Step 2: Create and prepare dev builder
    const devBuilder = new DevBuilder({
      root: testRoot,
      contentSource,
    });

    // Prepare the vibelog directory (copy template and install deps)
    await devBuilder.prepare();

    // Verify .vibelog directory was created
    const vibelogDir = join(testRoot, '.vibelog');
    expect(await fs.exists(vibelogDir)).toBe(true);

    // Verify template files were copied
    expect(await fs.exists(join(vibelogDir, 'package.json'))).toBe(true);
    expect(await fs.exists(join(vibelogDir, 'src'))).toBe(true);
    expect(await fs.exists(join(vibelogDir, 'public'))).toBe(true);

    // Step 3: Fetch and write content
    await devBuilder.fetchContent();

    // Verify content was written
    const blogDir = join(vibelogDir, 'src', 'content', 'blog');
    expect(await fs.exists(blogDir)).toBe(true);

    // Check that blog posts were created
    const firstPostPath = join(blogDir, 'first-post.md');
    const secondPostPath = join(blogDir, 'second-post.md');
    expect(await fs.exists(firstPostPath)).toBe(true);
    expect(await fs.exists(secondPostPath)).toBe(true);

    // Verify post content
    const firstPostContent = await fs.readFile(firstPostPath, 'utf-8');
    expect(firstPostContent).toContain('First Test Post');
    expect(firstPostContent).toContain('first-post');

    // Verify author was written
    const authorPath = join(vibelogDir, 'src', 'content', 'author.md');
    expect(await fs.exists(authorPath)).toBe(true);
    const authorContent = await fs.readFile(authorPath, 'utf-8');
    expect(authorContent).toContain('Test Author');

    // Verify site config was generated
    const constsPath = join(vibelogDir, 'src', 'consts.ts');
    expect(await fs.exists(constsPath)).toBe(true);
    const constsContent = await fs.readFile(constsPath, 'utf-8');
    expect(constsContent).toContain('SITE_TITLE');
    expect(constsContent).toContain('SITE_DESCRIPTION');
  }, 60000); // 1 minute timeout

  it('should throw error when building without dev preparation', async () => {
    const vibelogDir = join(testRoot, '.vibelog');
    const outDir = join(testRoot, 'dist');

    await expect(
      buildFromVibelog({
        vibelogDir,
        outDir,
        site: 'https://test-blog.com',
      }),
    ).rejects.toThrow('No ".vibelog" directory found');
  });

  it('should reuse existing .vibelog directory on second prepare', async () => {
    const contentSource = new FsSource(fixtureContentDir);
    const devBuilder = new DevBuilder({
      root: testRoot,
      contentSource,
    });

    // First prepare
    await devBuilder.prepare();
    const vibelogDir = join(testRoot, '.vibelog');
    const firstPrepareStat = fs.statSync(vibelogDir);

    // Second prepare should reuse existing directory
    await devBuilder.prepare();
    const secondPrepareStat = fs.statSync(vibelogDir);

    // The directory should not have been recreated (same inode and modification time)
    expect(secondPrepareStat.ino).toBe(firstPrepareStat.ino);
    expect(secondPrepareStat.mtimeMs).toBe(firstPrepareStat.mtimeMs);
  }, 60000);
});
