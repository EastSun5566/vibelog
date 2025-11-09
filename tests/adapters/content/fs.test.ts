import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { FsSource } from '../../../src/adapters/content/fs';

// Mock dependencies
vi.mock('fs-extra', () => ({
  default: {
    exists: vi.fn(),
    readdir: vi.fn(),
  },
}));

vi.mock('gray-matter', () => ({
  default: {
    read: vi.fn(),
  },
}));

vi.mock('../../../src/core', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('FsSource', () => {
  const testContentDir = '/test/content';
  let mockExists: ReturnType<typeof vi.fn>;
  let mockReaddir: ReturnType<typeof vi.fn>;
  let mockMatterRead: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const fs = await import('fs-extra');
    const matter = await import('gray-matter');

    mockExists = vi.mocked(fs.default.exists);
    mockReaddir = vi.mocked(fs.default.readdir);
    mockMatterRead = vi.mocked(matter.default.read);
  });

  describe('constructor', () => {
    it('should create FsSource with content directory', () => {
      const source = new FsSource(testContentDir);

      expect(source.name).toBe('fs');
      expect(source.contentDir).toBe(testContentDir);
    });

    it('should throw error when content directory is empty', () => {
      expect(() => new FsSource('')).toThrow('Content directory is required');
    });
  });

  describe('getPosts', () => {
    it('should read and parse markdown files from blog directory', async () => {
      const mockFiles = ['post1.md', 'post2.md', 'post3.txt']; // .txt should be filtered out
      const mockPostData = {
        data: {
          title: 'Test Post',
          slug: 'test-post',
          date: '2024-01-01',
        },
        content: 'This is test content',
      };

      mockExists.mockResolvedValue(true);
      mockReaddir.mockResolvedValue(mockFiles);
      mockMatterRead.mockReturnValue(mockPostData);

      const source = new FsSource(testContentDir);
      const result = await source.getPosts();

      expect(mockExists).toHaveBeenCalledWith(testContentDir);
      expect(mockExists).toHaveBeenCalledWith(join(testContentDir, 'blog'));
      expect(mockReaddir).toHaveBeenCalledWith(join(testContentDir, 'blog'));
      expect(mockMatterRead).toHaveBeenCalledTimes(2); // Only .md files

      expect(result.posts).toHaveLength(2);
      expect(result.posts[0]).toEqual({
        id: 'post1',
        title: 'Test Post',
        content: 'This is test content',
        slug: 'test-post',
        date: '2024-01-01T00:00:00.000Z',
      });
    });

    it('should use filename as slug when slug is not provided', async () => {
      const mockFiles = ['test-post.md'];
      const mockPostData = {
        data: {
          title: 'Test Post',
          date: '2024-01-01',
        },
        content: 'Content without slug',
      };

      mockExists.mockResolvedValue(true);
      mockReaddir.mockResolvedValue(mockFiles);
      mockMatterRead.mockReturnValue(mockPostData);

      const source = new FsSource(testContentDir);
      const result = await source.getPosts();

      expect(result.posts[0].slug).toBe('test-post');
    });

    it('should use current date when date is not provided', async () => {
      const mockFiles = ['post.md'];
      const mockPostData = {
        data: {
          title: 'Test Post',
        },
        content: 'Content without date',
      };

      mockExists.mockResolvedValue(true);
      mockReaddir.mockResolvedValue(mockFiles);
      mockMatterRead.mockReturnValue(mockPostData);

      const source = new FsSource(testContentDir);
      const result = await source.getPosts();

      // Should have a valid ISO date string
      expect(result.posts[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should throw error when content directory does not exist', async () => {
      mockExists.mockImplementation((path) => {
        if (path === testContentDir) return Promise.resolve(false);
        return Promise.resolve(true);
      });

      const source = new FsSource(testContentDir);

      await expect(source.getPosts()).rejects.toThrow(`Content directory not found: ${testContentDir}`);
    });

    it('should throw error when blog directory does not exist', async () => {
      mockExists.mockImplementation((path) => {
        if (path === testContentDir) return Promise.resolve(true);
        if (path === join(testContentDir, 'blog')) return Promise.resolve(false);
        return Promise.resolve(true);
      });

      const source = new FsSource(testContentDir);

      await expect(source.getPosts()).rejects.toThrow(`Blog directory not found: ${join(testContentDir, 'blog')}`);
    });
  });

  describe('getAuthor', () => {
    it('should read and parse author.md file', async () => {
      const mockAuthorData = {
        data: {
          name: 'John Doe',
          bio: 'Author bio from frontmatter',
        },
        content: 'Author bio from content',
      };

      mockExists.mockResolvedValue(true);
      mockMatterRead.mockReturnValue(mockAuthorData);

      const source = new FsSource(testContentDir);
      const result = await source.getAuthor();

      expect(mockExists).toHaveBeenCalledWith(join(testContentDir, 'author.md'));
      expect(mockMatterRead).toHaveBeenCalledWith(join(testContentDir, 'author.md'));

      expect(result).toEqual({
        name: 'John Doe',
        bio: 'Author bio from content',
      });
    });

    it('should use default name when name is not provided', async () => {
      const mockAuthorData = {
        data: {},
        content: 'Author bio',
      };

      mockExists.mockResolvedValue(true);
      mockMatterRead.mockReturnValue(mockAuthorData);

      const source = new FsSource(testContentDir);
      const result = await source.getAuthor();

      expect(result.name).toBe('Unknown Author');
    });

    it('should use bio from frontmatter when content is empty', async () => {
      const mockAuthorData = {
        data: {
          name: 'John Doe',
          bio: 'Bio from frontmatter',
        },
        content: '   \n  ',
      };

      mockExists.mockResolvedValue(true);
      mockMatterRead.mockReturnValue(mockAuthorData);

      const source = new FsSource(testContentDir);
      const result = await source.getAuthor();

      expect(result.bio).toBe('Bio from frontmatter');
    });

    it('should throw error when author.md does not exist', async () => {
      mockExists.mockResolvedValue(false);

      const source = new FsSource(testContentDir);

      await expect(source.getAuthor()).rejects.toThrow(`Author profile not found: ${join(testContentDir, 'author.md')}`);
    });
  });
});
