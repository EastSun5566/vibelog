import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { buildBlog, ContentSourceName, createDevBuilder, DEFAULT_DESIGN_V2, writeSourceSnapshot } from '../dist/index.js';

const root = await mkdtemp(join(tmpdir(), 'vibelog-design-baseline-'));
try {
  const posts = Array.from({ length: 20 }, (_, index) => ({
    id: `post-${String(index + 1)}`,
    title: `Sample article ${String(index + 1)}`,
    slug: `sample-${String(index + 1)}`,
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    content: `# Sample article\n\n${'A representative paragraph of writing. '.repeat(70)}\n\n\`\`\`ts\nconst article = ${String(index + 1)};\n\`\`\``,
    tags: ['Writing', index % 2 ? 'Code' : 'Design'],
  }));
  const builder = createDevBuilder({
    root,
    contentSource: {
      name: ContentSourceName.HACKMD,
      getPosts: () => Promise.resolve({ posts }),
      getAuthor: () => Promise.resolve({ name: 'Sample writer', bio: 'Synthetic benchmark content' }),
    },
  });
  await builder.prepare({ installDependencies: false });
  const summary = await builder.fetchContent();
  const sourceDir = join(root, 'source');
  await writeSourceSnapshot(builder.vibelogDir, sourceDir, summary);
  const samples = [];
  for (const run of [1, 2, 3]) {
    const stages = {};
    const started = performance.now();
    const workDir = join(root, `build-${String(run)}`);
    await buildBlog({
      sourceDir,
      design: DEFAULT_DESIGN_V2,
      workDir,
      outDir: join(workDir, 'dist'),
      site: 'https://example.com',
      onStageTiming: (stage, durationMs) => { stages[stage] = durationMs; },
    });
    samples.push({ run, totalMs: Math.round(performance.now() - started), stages });
  }
  console.log(JSON.stringify({ event: 'design_build_v2_benchmark', postCount: posts.length, samples }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
