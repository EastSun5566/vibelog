import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '../../src/core/logger.js';

// Mock console methods
const mockConsole = {
  log: vi.spyOn(console, 'log').mockImplementation(() => {
    // Empty implementation for testing
  }),
  error: vi.spyOn(console, 'error').mockImplementation(() => {
    // Empty implementation for testing
  }),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {
    // Empty implementation for testing
  }),
  info: vi.spyOn(console, 'info').mockImplementation(() => {
    // Empty implementation for testing
  }),
};

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should log info messages', () => {
    logger.info('Test info message');
    expect(mockConsole.info).toHaveBeenCalledWith(
      expect.stringContaining('[vibelog]'),
      'Test info message',
    );
  });

  it('should log error messages', () => {
    logger.error('Test error message');
    expect(mockConsole.error).toHaveBeenCalledWith(
      expect.stringContaining('[vibelog]'),
      'Test error message',
    );
  });

  it('should log warning messages', () => {
    logger.warn('Test warning message');
    expect(mockConsole.warn).toHaveBeenCalledWith(
      expect.stringContaining('[vibelog]'),
      'Test warning message',
    );
  });

  it('should include timestamp and prefix in messages', () => {
    logger.info('Test message');
    expect(mockConsole.info).toHaveBeenCalledWith(
      expect.stringContaining('[vibelog]'),
      'Test message',
    );
  });

  it('should handle multiple arguments', () => {
    logger.info('Message', 'arg1', 'arg2');
    expect(mockConsole.info).toHaveBeenCalledWith(
      expect.stringContaining('[vibelog]'),
      'Message',
      'arg1',
      'arg2',
    );
  });
});
