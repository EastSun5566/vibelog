import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Map test imports to packages/core/src
      '../../../src': resolve(__dirname, './packages/core/src'),
      '../../src': resolve(__dirname, './packages/core/src'),
    },
  },
  test: {
    testTimeout: 120000, // Increase timeout for e2e tests
  },
});
