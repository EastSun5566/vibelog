import { readdir, readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ContentSourceName,
  buildFromVibelog,
  createDevBuilder,
} from '@vibelog/core';

const packageDirectories = await readdir('/app/node_modules/.pnpm');
for (const prefix of ['drizzle-kit@', 'vitest@']) {
  if (packageDirectories.some((directory) => directory.startsWith(prefix))) {
    throw new Error(`Development dependency leaked into the runtime image: ${prefix}`);
  }
}

const root = await mkdtemp(join(tmpdir(), 'vibelog-runtime-build-'));
try {
  const builder = createDevBuilder({
    root,
    contentSource: {
      name: ContentSourceName.HACKMD,
      getAuthor: () => Promise.resolve({ name: 'Smoke', bio: 'Runtime build' }),
      getPosts: () => Promise.resolve({
        posts: [{
          id: 'runtime-article',
          title: 'Runtime article',
          slug: 'runtime-article',
          date: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-03T12:00:00Z',
          tags: ['Runtime'],
          content: 'Built inside the production dependency tree.',
        }],
      }),
    },
  });

  await builder.prepare({ installDependencies: false });
  await builder.fetchContent();
  const outDir = join(root, 'public');
  await buildFromVibelog({
    vibelogDir: join(root, '.vibelog'),
    outDir,
    site: 'https://smoke.example.com',
  });

  const home = await readFile(join(outDir, 'index.html'), 'utf8');
  if (!home.includes('Runtime article')) {
    throw new Error('Production runtime could not build the Astro template');
  }
  const article = await readFile(join(outDir, 'blog', 'runtime-article', 'index.html'), 'utf8');
  const tagPage = await readFile(join(outDir, 'tags', 'runtime', 'index.html'), 'utf8');
  if (!article.includes('article:modified_time') || !tagPage.includes('Runtime article')) {
    throw new Error('Production runtime omitted synchronized article metadata');
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
