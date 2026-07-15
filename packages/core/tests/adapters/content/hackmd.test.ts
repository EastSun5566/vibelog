import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HackMdSource } from '../../../src/adapters/content/hackmd.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock logger
vi.mock('../../../src/core/index.js', () => ({
  logger: {
    info: vi.fn(),
  },
}));

describe('HackMD Content Adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('HackMdSource constructor', () => {
    it('should create adapter with correct username', () => {
      const username = 'testuser';
      const adapter = new HackMdSource(username);

      expect(adapter.name).toBe('hackmd');
      expect(adapter.username).toBe(username);
      expect(adapter).toHaveProperty('getPosts');
      expect(adapter).toHaveProperty('getAuthor');
      expect(typeof adapter.getPosts).toBe('function');
      expect(typeof adapter.getAuthor).toBe('function');
    });

    it('should throw error for empty username', () => {
      expect(() => new HackMdSource('')).toThrow();
    });
  });

  describe('adapter methods', () => {
    const adapter = new HackMdSource('testuser');

    it('should have getPosts method that returns a promise', () => {
      // Mock the fetch calls
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ notes: [] }),
      });

      const result = adapter.getPosts();
      expect(result).toBeInstanceOf(Promise);
    });

    it('should have getAuthor method that returns a promise', () => {
      // Mock the fetch call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ user: { displayName: 'Test User', biography: 'Test bio' } }),
      });

      const result = adapter.getAuthor();
      expect(result).toBeInstanceOf(Promise);
    });

    it('should handle fetch errors in getPosts', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      });

      await expect(adapter.getPosts()).rejects.toThrow('Failed to fetch HackMD content: Not Found');
    });

    it('should handle fetch errors in getAuthor', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      });

      await expect(adapter.getAuthor()).rejects.toThrow('Failed to fetch HackMD profile: Not Found');
    });
  });
});
