import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotionSource } from '../../../src/adapters/content/notion.js';
import { APIErrorCode } from '@notionhq/client';

// Mock dependencies
vi.mock('@notionhq/client', () => ({
  Client: vi.fn(),
  APIErrorCode: {
    ObjectNotFound: 'object_not_found',
    Unauthorized: 'unauthorized',
    ValidationError: 'validation_error',
  },
  isNotionClientError: vi.fn(),
  isFullPage: vi.fn(),
  collectPaginatedAPI: vi.fn(),
}));

vi.mock('notion-to-md', () => ({
  NotionToMarkdown: vi.fn(),
}));

vi.mock('../../../src/core/index.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
  slugify: vi.fn((text: string) => text.toLowerCase().replace(/\s+/g, '-')),
}));

vi.mock('../../../src/adapters/content/utils.js', () => ({
  removeFirstH1IfMatchesTitle: vi.fn((content: string) => content),
}));

describe('NotionSource', () => {
  const testDatabaseId = 'test-database-id';
  let mockNotion: {
    databases: {
      query: ReturnType<typeof vi.fn>;
      retrieve: ReturnType<typeof vi.fn>;
    };
    users: {
      retrieve: ReturnType<typeof vi.fn>;
    };
  };
  let mockN2m: {
    pageToMarkdown: ReturnType<typeof vi.fn>;
    toMarkdownString: ReturnType<typeof vi.fn>;
  };
  let mockCollectPaginatedAPI: ReturnType<typeof vi.fn>;
  let mockIsNotionClientError: ReturnType<typeof vi.fn>;
  let mockIsFullPage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set environment variable
    process.env.NOTION_TOKEN = 'test-token';

    const notionClient = await import('@notionhq/client');
    const notionToMd = await import('notion-to-md');

    mockCollectPaginatedAPI = vi.mocked(notionClient.collectPaginatedAPI);
    mockIsNotionClientError = vi.mocked(notionClient.isNotionClientError);
    mockIsFullPage = vi.mocked(notionClient.isFullPage);

    mockNotion = {
      databases: {
        query: vi.fn(),
        retrieve: vi.fn(),
      },
      users: {
        retrieve: vi.fn(),
      },
    };

    mockN2m = {
      pageToMarkdown: vi.fn(),
      toMarkdownString: vi.fn(),
    };

    vi.mocked(notionClient.Client).mockImplementation(() => mockNotion as unknown as InstanceType<typeof notionClient.Client>);
    vi.mocked(notionToMd.NotionToMarkdown).mockImplementation(() => mockN2m as unknown as InstanceType<typeof notionToMd.NotionToMarkdown>);
  });

  afterEach(() => {
    delete process.env.NOTION_TOKEN;
  });

  describe('constructor', () => {
    it('should create NotionSource with database ID', () => {
      const source = new NotionSource(testDatabaseId);

      expect(source.name).toBe('notion');
      expect(source.databaseId).toBe(testDatabaseId);
    });

    it('should throw error when database ID is empty', () => {
      expect(() => new NotionSource('')).toThrow('Notion database ID is required');
    });

    it('should throw error when NOTION_TOKEN is not set', () => {
      delete process.env.NOTION_TOKEN;

      expect(() => new NotionSource(testDatabaseId)).toThrow('A Notion token is required');
    });
  });

  describe('getPosts', () => {
    const mockPages = [
      {
        id: 'page-1',
        created_time: '2024-01-01T00:00:00.000Z',
        properties: {
          Title: {
            type: 'title',
            title: [{ plain_text: 'Test Post 1' }],
          },
          Date: {
            type: 'date',
            date: { start: '2024-01-01' },
          },
        },
      },
      {
        id: 'page-2',
        created_time: '2024-01-02T00:00:00.000Z',
        properties: {
          Name: {
            type: 'title',
            title: [{ plain_text: 'Test Post 2' }],
          },
        },
      },
    ];

    beforeEach(() => {
      mockIsFullPage.mockReturnValue(true);
      mockCollectPaginatedAPI.mockResolvedValue(mockPages);
      mockN2m.pageToMarkdown.mockResolvedValue([]);
      mockN2m.toMarkdownString.mockReturnValue({ parent: '# Test Content' });
    });

    it('should fetch and process posts from Notion database', async () => {
      const source = new NotionSource(testDatabaseId);
      const result = await source.getPosts();

      expect(mockCollectPaginatedAPI).toHaveBeenCalledWith(
        mockNotion.databases.query,
        { database_id: testDatabaseId },
      );
      expect(mockN2m.pageToMarkdown).toHaveBeenCalledTimes(2);
      expect(result.posts).toHaveLength(2);

      expect(result.posts[0]).toEqual({
        id: 'page-1',
        title: 'Test Post 1',
        content: '# Test Content',
        slug: 'test-post-1',
        date: '2024-01-01T00:00:00.000Z',
      });
    });

    it('should use created_time when date property is not available', async () => {
      const source = new NotionSource(testDatabaseId);
      const result = await source.getPosts();

      expect(result.posts[1].date).toBe('2024-01-02T00:00:00.000Z');
    });

    it('should use "Untitled" when title is not found', async () => {
      const pagesWithoutTitle = [
        {
          id: 'page-without-title',
          created_time: '2024-01-01T00:00:00.000Z',
          properties: {},
        },
      ];

      mockCollectPaginatedAPI.mockResolvedValue(pagesWithoutTitle);

      const source = new NotionSource(testDatabaseId);
      const result = await source.getPosts();

      expect(result.posts[0].title).toBe('Untitled');
    });

    it('should handle Notion API errors', async () => {
      const notionError = new Error('Notion API Error') as Error & { code: string };
      notionError.code = APIErrorCode.ObjectNotFound;

      mockIsNotionClientError.mockReturnValue(true);
      mockCollectPaginatedAPI.mockRejectedValue(notionError);

      const source = new NotionSource(testDatabaseId);

      await expect(source.getPosts()).rejects.toThrow(
        `Notion database not found: ${testDatabaseId}`,
      );
    });

    it('should handle unauthorized errors', async () => {
      const notionError = new Error('Unauthorized') as Error & { code: string };
      notionError.code = APIErrorCode.Unauthorized;

      mockIsNotionClientError.mockReturnValue(true);
      mockCollectPaginatedAPI.mockRejectedValue(notionError);

      const source = new NotionSource(testDatabaseId);

      await expect(source.getPosts()).rejects.toThrow(
        'Invalid Notion token or insufficient permissions',
      );
    });

    it('should handle validation errors', async () => {
      const notionError = new Error('Validation Error') as Error & { code: string };
      notionError.code = APIErrorCode.ValidationError;

      mockIsNotionClientError.mockReturnValue(true);
      mockCollectPaginatedAPI.mockRejectedValue(notionError);

      const source = new NotionSource(testDatabaseId);

      await expect(source.getPosts()).rejects.toThrow(
        `Invalid database ID format: ${testDatabaseId}`,
      );
    });

    it('should re-throw non-Notion errors', async () => {
      const genericError = new Error('Generic error');

      mockIsNotionClientError.mockReturnValue(false);
      mockCollectPaginatedAPI.mockRejectedValue(genericError);

      const source = new NotionSource(testDatabaseId);

      await expect(source.getPosts()).rejects.toThrow('Generic error');
    });
  });

  describe('getAuthor', () => {
    it('should fetch author information from database', async () => {
      const mockDatabase = {
        created_by: { id: 'user-123' },
        title: [{ plain_text: 'My Blog Database' }],
      };

      const mockUser = {
        name: 'John Doe',
      };

      mockNotion.databases.retrieve.mockResolvedValue(mockDatabase);
      mockNotion.users.retrieve.mockResolvedValue(mockUser);

      const source = new NotionSource(testDatabaseId);
      const result = await source.getAuthor();

      expect(mockNotion.databases.retrieve).toHaveBeenCalledWith({
        database_id: testDatabaseId,
      });
      expect(mockNotion.users.retrieve).toHaveBeenCalledWith({
        user_id: 'user-123',
      });

      expect(result).toEqual({
        name: 'John Doe',
        bio: 'My Blog Database',
      });
    });

    it('should handle missing user information', async () => {
      const mockDatabase = {
        created_by: { id: 'user-123' },
        title: [{ plain_text: 'My Blog Database' }],
      };

      mockNotion.databases.retrieve.mockResolvedValue(mockDatabase);
      mockNotion.users.retrieve.mockRejectedValue(new Error('User not found'));

      const source = new NotionSource(testDatabaseId);
      const result = await source.getAuthor();

      expect(result.name).toBe('');
    });

    it('should handle database without created_by', async () => {
      const mockDatabase = {
        title: [{ plain_text: 'My Blog Database' }],
      };

      mockNotion.databases.retrieve.mockResolvedValue(mockDatabase);

      const source = new NotionSource(testDatabaseId);
      const result = await source.getAuthor();

      expect(result.name).toBe('');
      expect(mockNotion.users.retrieve).not.toHaveBeenCalled();
    });
  });
});
