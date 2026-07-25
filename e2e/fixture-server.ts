import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ContentSourceName } from '../packages/core/src/index.js';
import type { AiProvider, ContentSource } from '../packages/core/src/index.js';
import { AppDatabase } from '../packages/app/src/database.js';
import type { AppConfig } from '../packages/app/src/config.js';
import { createApp } from '../packages/app/src/index.js';
import { OperationWorker } from '../packages/app/src/jobs.js';
import { startHttpServer, closeHttpServer } from '../packages/app/src/server-runtime.js';

const dataRoot = await mkdtemp(join(tmpdir(), 'vibelog-e2e-'));
const config: AppConfig = {
  nodeEnv: 'test', dataRoot, appOrigin: 'http://app.localtest.me:3100', appHostname: 'app.localtest.me', previewOrigin: 'http://preview.app.localtest.me:3100',
  betterAuthSecret: 'e2e-secret-that-is-at-least-thirty-two-characters', betaInviteDigest: createHash('sha256').update('vibelog-e2e-beta-invite-code').digest(),
  aiUserDailyLimit: 20, aiGlobalDailyLimit: 200, aiProvider: 'fake', aiModel: 'fake', secureCookies: false,
};
let successfulSyncs = 0;
const content: ContentSource = {
  name: ContentSourceName.HACKMD,
  getAuthor() { return Promise.resolve({ name: 'Alice Writer', bio: 'Notes about building humane software.' }); },
  getPosts() {
    successfulSyncs += 1;
    return Promise.resolve({ posts: [
      {
        id: 'hello', title: 'Hello VibeLog', slug: 'hello-vibelog', date: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-21T12:00:00.000Z', tags: ['Product', 'Writing'],
        content: `![Private image](https://images.example.com/private.png)

# Intro heading

This is **reliable** public prose with [readable text](https://example.com/hidden) and \`code\`.

## Design choices

The design keeps the writing first.

### Implementation details

The published article stays static and scriptless.${successfulSyncs >= 5 ? '\n\nThis paragraph was corrected after publication.' : ''}`,
      },
      { id: 'archive', title: 'Archive Note', slug: 'archive-note', date: '2026-07-18T00:00:00.000Z', tags: ['Archive'], content: 'This article can be excluded.' },
      ...(successfulSyncs >= 4 ? [{ id: 'new', title: 'Newly Synced Note', slug: 'newly-synced-note', date: '2026-07-20T00:00:00.000Z', tags: ['Product'], content: 'This article appeared in a later sync.' }] : []),
      ...(successfulSyncs >= 5 ? [{ id: 'after-publish', title: 'After Publish Note', slug: 'after-publish-note', date: '2026-07-22T00:00:00.000Z', tags: ['Product'], content: 'This article appeared after the first live release.' }] : []),
    ] });
  },
};
const missingContent: ContentSource = {
  name: ContentSourceName.HACKMD,
  getAuthor() { return Promise.reject(new Error('Failed to fetch HackMD profile: Not Found')); },
  getPosts() { return Promise.reject(new Error('Failed to fetch HackMD content: Not Found')); },
};
const ai: AiProvider = {
  name: 'fake', modelId: 'fake',
  generate(input) {
    if (input.currentTheme.preset !== 'editorial' || input.currentTheme.colors.background !== '#f5f0e6' || input.currentTheme.headerStyle !== 'centered' || input.currentTheme.postListStyle !== 'numbered' || input.currentTheme.codeBlockStyle !== 'panel') throw new Error('AI did not receive the current Theme Studio preview');
    return Promise.resolve({ ...input.currentTheme, colors: { ...input.currentTheme.colors, background: '#fffaf0', surface: '#f5ead7' }, description: 'A warm editorial theme.' });
  },
};
const database = new AppDatabase(dataRoot);
const { app } = createApp({ config, database });
const worker = new OperationWorker(database, config, { contentSource: (username) => username === 'missing-hackmd' ? missingContent : content, aiProvider: () => ai });
const server = startHttpServer(app.fetch, { ...process.env, HOST: '127.0.0.1', PORT: '3100' });
const workerPromise = worker.run(50);
async function shutdown(): Promise<void> { worker.stop(); await closeHttpServer(server); await workerPromise; database.close(); await rm(dataRoot, { recursive: true, force: true }); }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void shutdown().then(() => process.exit(0)); });
