import { build } from 'esbuild';

const minify = process.argv.includes('--minify');
const shared = {
  bundle: true,
  format: 'esm' as const,
  minify,
  platform: 'browser' as const,
  target: 'es2022',
};

await Promise.all([
  build({ ...shared, entryPoints: ['src/browser/main.ts'], outfile: 'dist/assets/client.js' }),
  build({ ...shared, entryPoints: ['src/browser/analytics.ts'], outfile: 'dist/assets/analytics.js' }),
]);
