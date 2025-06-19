import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig } from '../src/core/config';

// Mock fs-extra and logger
vi.mock('fs-extra');
vi.mock('./logger');

describe('Config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadConfig', () => {
    it('should return default config structure', async () => {
      const config = await loadConfig('/test/root');

      expect(config).toHaveProperty('site');
      expect(config.site).toEqual({});
    });

    it('should have the correct config type structure', async () => {
      const config = await loadConfig('/test/root');

      // Test that the config has the expected shape
      expect(config).toMatchObject({
        site: {},
      });
    });
  });
});
