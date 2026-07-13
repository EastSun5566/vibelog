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
    // Clean up temporary directory with retry logic
    if (testRoot) {
      try {
        await fs.rm(testRoot, { recursive: true, force: true, maxRetries: 3 });
      } catch (error) {
        // Ignore cleanup errors in tests
        console.warn(`Failed to clean up test directory: ${testRoot}`, error);
      }
    }
  });

  it('should complete the full workflow from content to production build', async () => {
    // Step 1: Create a content source from fixtures
    const contentSource = new FsSource(fixtureContentDir);

    // Verify content source can fetch posts and author
    const { posts } = await contentSource.getPosts();
    const author = await contentSource.getAuthor();

    const sortedPosts = [...posts].sort((a, b) => a.title.localeCompare(b.title));

    expect(sortedPosts).toHaveLength(2);
    expect(sortedPosts[0].title).toBe('First Test Post');
    expect(sortedPosts[1].title).toBe('Second Test Post');
    expect(author.name).toBe('Test Author');

    // Step 2: Create and prepare dev builder
    const devBuilder = new DevBuilder({
      root: testRoot,
      contentSource,
    });

    // Programmatic Astro uses the pinned workspace runtime; no network install is needed.
    await devBuilder.prepare({ installDependencies: false });

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

    const outDir = join(testRoot, 'dist');
    await buildFromVibelog({ vibelogDir, outDir, site: 'https://test-blog.example' });
    expect(await fs.exists(join(outDir, 'index.html'))).toBe(true);
  }, 120000); // 2 minutes timeout for full workflow

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
  }, 60000);

  it('should reuse existing .vibelog directory on second prepare', async () => {
    const contentSource = new FsSource(fixtureContentDir);
    const devBuilder = new DevBuilder({
      root: testRoot,
      contentSource,
    });

    // First prepare
    await devBuilder.prepare({ installDependencies: false });
    const vibelogDir = join(testRoot, '.vibelog');
    const firstPrepareEntries = fs.readdirSync(vibelogDir).sort();

    // Second prepare should reuse existing directory without recreating it
    await devBuilder.prepare({ installDependencies: false });
    const secondPrepareEntries = fs.readdirSync(vibelogDir).sort();

    // The directory should not have been recreated (contents should remain the same)
    expect(secondPrepareEntries).toEqual(firstPrepareEntries);
  }, 120000); // 2 minutes timeout
});
