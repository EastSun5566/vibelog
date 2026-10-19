import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const minify = process.argv.includes('--minify');
const shared = {
  bundle: true,
  format: 'esm' as const,
  minify,
  platform: 'browser' as const,
  target: 'es2022',
};

// Newsreader is OFL-1.1; keep its license next to the redistributed files.
const fontPackage = dirname(
  fileURLToPath(import.meta.resolve('@fontsource-variable/newsreader/package.json')),
);
const copyFonts = async () => {
  await mkdir('dist/assets/fonts', { recursive: true });
  await Promise.all([
    ...['newsreader-latin-wght-normal.woff2', 'newsreader-latin-wght-italic.woff2'].map((file) =>
      copyFile(join(fontPackage, 'files', file), join('dist/assets/fonts', file)),
    ),
    copyFile(join(fontPackage, 'LICENSE'), 'dist/assets/fonts/LICENSE'),
  ]);
};

await Promise.all([
  build({ ...shared, entryPoints: ['src/browser/main.ts'], outfile: 'dist/assets/client.js' }),
  build({
    ...shared,
    entryPoints: ['src/browser/analytics.ts'],
    outfile: 'dist/assets/analytics.js',
  }),
  copyFonts(),
]);
