import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    // Map old import paths to new package structure
    alias: {
      '../../src': resolve(__dirname, './packages/core/src'),
    },
  },
});
