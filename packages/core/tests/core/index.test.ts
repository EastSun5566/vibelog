import { describe, it, expect } from 'vitest';
import * as coreIndex from '../../src/core/index.js';

describe('Core Index', () => {
  it('should export all core modules', () => {
    // Test that all expected exports are available
    expect(coreIndex).toHaveProperty('DevBuilder');
    expect(coreIndex).toHaveProperty('createDevBuilder');
    expect(coreIndex).toHaveProperty('buildFromVibelog');
    expect(coreIndex).toHaveProperty('StyleTransformer');
    expect(coreIndex).toHaveProperty('createStyleTransformer');
    expect(coreIndex).toHaveProperty('logger');
    expect(coreIndex).toHaveProperty('generateSlug');
    expect(coreIndex).toHaveProperty('slugify');
  });

  it('should export builder functions', () => {
    expect(typeof coreIndex.DevBuilder).toBe('function');
    expect(typeof coreIndex.createDevBuilder).toBe('function');
    expect(typeof coreIndex.buildFromVibelog).toBe('function');
  });

  it('should export transformer functions', () => {
    expect(typeof coreIndex.StyleTransformer).toBe('function');
    expect(typeof coreIndex.createStyleTransformer).toBe('function');
  });

  it('should export logger', () => {
    expect(typeof coreIndex.logger).toBe('object');
    expect(coreIndex.logger).toHaveProperty('info');
    expect(coreIndex.logger).toHaveProperty('error');
    expect(coreIndex.logger).toHaveProperty('warn');
  });

  it('should export utility functions', () => {
    expect(typeof coreIndex.generateSlug).toBe('function');
    expect(typeof coreIndex.slugify).toBe('function');
  });
});
