import { defineConfig } from 'tsdown';

export default defineConfig(() => ({
  entry: ['src/cli/index.ts'],
  minify: true,
}));
