import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DevBuilder, createDevBuilder, buildFromVibelog } from '../../src/core/builder';
import { ContentSourceName } from '../../src/consts';
import type { ContentSource, Post, Author } from '../../src/types';

// Mock dependencies
vi.mock('fs-extra', () => ({
  default: {
    exists: vi.fn(),
    copy: vi.fn(),
    writeFile: vi.fn(),
    ensureDir: vi.fn(),
    emptyDir: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));
vi.mock('astro', () => ({
  build: vi.fn(),
}));
vi.mock('../../src/core/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('../../src/core/config', () => ({
  loadConfig: vi.fn(),
}));

describe('Builder', () => {
  let mockContentSource: ContentSource;
  let mockGetPosts: ReturnType<typeof vi.fn>;
  let mockGetAuthor: ReturnType<typeof vi.fn>;

  const mockPosts: Post[] = [
    {
      id: '1',
      title: 'Test Post 1',
      content: 'This is test content',
      date: '2024-01-01',
      slug: 'test-post-1',
    },
    {
      id: '2',
      title: 'Test Post 2',
      content: 'Another test content',
      date: '2024-01-02',
      slug: 'test-post-2',
    },
  ];

  const mockAuthor: Author = {
    name: 'Test Author',
    bio: 'Test bio',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetPosts = vi.fn();
    mockGetAuthor = vi.fn();

    mockContentSource = {
      name: ContentSourceName.FS,
      getPosts: mockGetPosts,
      getAuthor: mockGetAuthor,
    };

    mockGetPosts.mockResolvedValue({ posts: mockPosts });
    mockGetAuthor.mockResolvedValue(mockAuthor);
  });

  describe('DevBuilder', () => {
    it('should create DevBuilder with correct properties', () => {
      const builder = new DevBuilder({
        root: '/test/root',
        contentSource: mockContentSource,
      });

      expect(builder.root).toBe('/test/root');
      expect(builder.contentSource).toBe(mockContentSource);
      expect(builder.vibelogDir).toContain('.vibelog');
    });

    describe('fetchContent', () => {
      it('should fetch and write content successfully', async () => {
        const { loadConfig } = await import('../../src/core/config');
        const fs = await import('fs-extra');

        vi.mocked(loadConfig).mockResolvedValue({
          site: { title: 'Test Site', description: 'Test Description' },
        });
        vi.mocked(fs.default.ensureDir).mockResolvedValue(undefined);
        vi.mocked(fs.default.emptyDir).mockResolvedValue(undefined);
        vi.mocked(fs.default.writeFile).mockResolvedValue(undefined);

        const builder = new DevBuilder({
          root: '/test/root',
          contentSource: mockContentSource,
        });

        await builder.fetchContent();

        expect(mockGetPosts).toHaveBeenCalled();
        expect(mockGetAuthor).toHaveBeenCalled();
        expect(fs.default.writeFile).toHaveBeenCalledWith(
          expect.stringContaining('consts.ts'),
          expect.stringContaining('SITE_TITLE'),
        );
      });
    });
  });

  describe('createDevBuilder', () => {
    it('should create and return DevBuilder instance', () => {
      const builder = createDevBuilder({
        root: '/test/root',
        contentSource: mockContentSource,
      });

      expect(builder).toBeInstanceOf(DevBuilder);
      expect(builder.root).toBe('/test/root');
    });
  });

  describe('buildFromVibelog', () => {
    it('should throw error when vibelog directory does not exist', async () => {
      const fs = await import('fs-extra');
      const mockExists = vi.mocked(fs.default.exists);
      mockExists.mockResolvedValue();

      await expect(buildFromVibelog({
        vibelogDir: '/test/.vibelog',
        outDir: '/test/dist',
        site: 'https://example.com',
      })).rejects.toThrow('No ".vibelog" directory found');
    });
  });
});
