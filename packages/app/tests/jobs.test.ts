import { AiProviderRequestError, DEFAULT_THEME } from '@vibelog/core';
import type { AiProvider } from '@vibelog/core';
import { describe, expect, it, vi } from 'vitest';
import type { OperationRuntimeConfig } from '../src/config.js';
import type { AppDatabase, BlogRecord, OperationRecord, ThemeRevisionRecord } from '../src/database.js';
import { AppOperationExecutor, operationPublicError } from '../src/jobs.js';
import type { ArtifactStore } from '../src/ports/artifact-store.js';

const now = '2026-09-10T00:00:00.000Z';
const operation = (id: string): OperationRecord => ({
  id, userId: 'user', blogId: 'blog', type: 'generate_theme', status: 'running',
  payload: { prompt: 'Quiet editorial theme', baseTheme: DEFAULT_THEME }, result: null,
  errorMessage: null, attempts: 1, lockedAt: now, leaseExpiresAt: now, createdAt: now, updatedAt: now,
});
const blog: BlogRecord = {
  id: 'blog', userId: 'user', username: 'writer', hackmdUsername: 'writer', title: 'Writer', description: null,
  author: null, language: 'en', state: 'ready', lastError: null, draftArtifactId: 'draft', contentVersion: 1,
  contentManifest: [], lastSyncedAt: now, createdAt: now, updatedAt: now,
};
const theme: ThemeRevisionRecord = {
  id: 'theme', blogId: blog.id, config: DEFAULT_THEME, prompt: null, description: DEFAULT_THEME.description,
  source: 'system', active: true, createdAt: now,
};
const config: OperationRuntimeConfig = {
  appOrigin: 'https://vibelog.org', appHostname: 'vibelog.org', databaseUrl: 'postgresql://unused',
  objectStore: { endpoint: 'https://unused.example.com', region: 'auto', bucket: 'unused', accessKeyId: 'unused', secretAccessKey: 'unused', forcePathStyle: false },
  queueMode: 'direct', operationPollIntervalMs: 1000, hackmdBaseUrl: 'https://hackmd.io', aiProvider: 'opencode-go', aiModel: 'qwen3.8-flash',
};

describe('AI operation execution', () => {
  it('uses the operation ID as the provider session ID', async () => {
    const generate = vi.fn<AiProvider['generate']>(() => Promise.resolve(DEFAULT_THEME));
    const aiProvider: AiProvider = { name: 'test', modelId: 'model', generate };
    const database = {
      claimOperation: vi.fn((id: string) => Promise.resolve(operation(id))),
      getBlog: vi.fn(() => Promise.resolve(blog)),
      updateOperationProgress: vi.fn(() => Promise.resolve()),
      getActiveTheme: vi.fn(() => Promise.resolve(theme)),
      completeThemeOperation: vi.fn(() => Promise.resolve(theme)),
    } as unknown as AppDatabase;
    const executor = new AppOperationExecutor(database, {} as ArtifactStore, config, { aiProvider: () => aiProvider });

    await executor.execute('11111111-1111-4111-8111-111111111111');
    await executor.execute('22222222-2222-4222-8222-222222222222');

    expect(generate.mock.calls.map((call) => call[1])).toEqual([
      { sessionId: '11111111-1111-4111-8111-111111111111' },
      { sessionId: '22222222-2222-4222-8222-222222222222' },
    ]);
  });

  it('distinguishes provider failures from invalid theme responses', () => {
    const providerMessage = operationPublicError('generate_theme', new AiProviderRequestError('AI provider request failed'));
    const validationMessage = operationPublicError('generate_theme', new Error('Invalid theme'));
    expect(providerMessage).toContain('temporarily unavailable');
    expect(validationMessage).toContain('valid theme');
  });
});
