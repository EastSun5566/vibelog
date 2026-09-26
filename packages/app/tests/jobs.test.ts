import { AiProviderRequestError, AiProviderTimeoutError, DEFAULT_DESIGN_V2, buildBlog, structuralBuildIdentity } from '@vibelog/core';
import type { AiProvider } from '@vibelog/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationRuntimeConfig } from '../src/config.js';
import type { AppDatabase, BlogRecord, OperationRecord, ThemeRevisionRecord } from '../src/database.js';
import { AppOperationExecutor, TerminalOperationError, operationPublicError } from '../src/jobs.js';
import type { ArtifactStore } from '../src/ports/artifact-store.js';

vi.mock('@vibelog/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vibelog/core')>();
  return { ...actual, buildBlog: vi.fn(() => Promise.resolve()) };
});

const now = '2026-09-10T00:00:00.000Z';
const operation = (id: string): OperationRecord => ({
  id, userId: 'user', blogId: 'blog', type: 'generate_design', status: 'running',
  payload: { prompt: 'Quiet editorial design', baseDesign: DEFAULT_DESIGN_V2, baseRevisionId: 'theme', sourceArtifactId: 'source', draftArtifactId: 'draft', draftDesignRevisionId: 'theme', contentVersion: 1 }, result: null,
  errorMessage: null, attempts: 1, lockedAt: now, leaseExpiresAt: now, createdAt: now, updatedAt: now,
});
const blog: BlogRecord = {
  id: 'blog', userId: 'user', username: 'writer', hackmdUsername: 'writer', title: 'Writer', description: null,
  author: null, language: 'en', state: 'ready', lastError: null, sourceArtifactId: 'source', draftArtifactId: 'draft', draftDesignRevisionId: 'theme', contentVersion: 1,
  contentProfile: { postCount: 3, tagCount: 2, averageLength: 'medium', codeUsage: 'some', imageUsage: 'none', mathUsage: 'none' },
  contentManifest: [], lastSyncedAt: now, createdAt: now, updatedAt: now,
};
const theme: ThemeRevisionRecord = {
  id: 'theme', blogId: blog.id, config: DEFAULT_DESIGN_V2, prompt: null, description: DEFAULT_DESIGN_V2.description,
  source: 'system', active: true, createdAt: now,
};
const historicalTheme: ThemeRevisionRecord = {
  ...theme,
  id: 'historical-design',
  config: { ...DEFAULT_DESIGN_V2, pages: { ...DEFAULT_DESIGN_V2.pages, index: { ...DEFAULT_DESIGN_V2.pages.index, layout: 'grid', columns: 2 } } },
  active: false,
  source: 'manual',
};
const config: OperationRuntimeConfig = {
  appOrigin: 'https://vibelog.org', appHostname: 'vibelog.org', databaseUrl: 'postgresql://unused',
  maintenanceStage: 'normal',
  objectStore: { endpoint: 'https://unused.example.com', region: 'auto', bucket: 'unused', accessKeyId: 'unused', secretAccessKey: 'unused', forcePathStyle: false },
  queueMode: 'direct', operationPollIntervalMs: 1000, hackmdBaseUrl: 'https://hackmd.io', aiProvider: 'opencode-go', aiModel: 'qwen3.8-flash', aiFallbackModels: ['glm-5.3-flash'],
};

describe('AI operation execution', () => {
  afterEach(() => {
    vi.mocked(buildBlog).mockResolvedValue(undefined);
  });

  it('uses the operation ID as the provider session ID', async () => {
    const generate = vi.fn<AiProvider['generate']>(() => Promise.resolve(historicalTheme.config));
    const aiProvider: AiProvider = { name: 'test', modelId: 'model', generate };
    const database = {
      claimOperation: vi.fn((id: string) => Promise.resolve(operation(id))),
      getBlog: vi.fn(() => Promise.resolve(blog)),
      updateOperationProgress: vi.fn(() => Promise.resolve()),
      getActiveDesign: vi.fn(() => Promise.resolve(theme)),
      listBuildCacheCandidates: vi.fn(() => Promise.resolve([])),
      createArtifact: vi.fn(() => Promise.resolve({ id: 'new-draft' })),
      completeDesignOperation: vi.fn(() => Promise.resolve(theme)),
      markArtifactCleanup: vi.fn(() => Promise.resolve()),
    } as unknown as AppDatabase;
    const artifacts = { materializeArtifact: vi.fn(), uploadDirectory: vi.fn() } as unknown as ArtifactStore;
    const executor = new AppOperationExecutor(database, artifacts, config, { aiProvider: () => aiProvider });

    await executor.execute('11111111-1111-4111-8111-111111111111');
    await executor.execute('22222222-2222-4222-8222-222222222222');

    expect(generate.mock.calls.map((call) => call[1])).toEqual([
      { sessionId: '11111111-1111-4111-8111-111111111111' },
      { sessionId: '22222222-2222-4222-8222-222222222222' },
    ]);
  });

  it('rejects a stale saved revision before calling the model or creating a draft', async () => {
    const generate = vi.fn<AiProvider['generate']>();
    const createArtifact = vi.fn();
    const stale = operation('88888888-8888-4888-8888-888888888888');
    stale.payload.baseRevisionId = 'older-design';
    const database = {
      claimOperation: vi.fn(() => Promise.resolve(stale)), getBlog: vi.fn(() => Promise.resolve(blog)),
      getActiveDesign: vi.fn(() => Promise.resolve(theme)), updateOperationProgress: vi.fn(() => Promise.resolve()),
      createArtifact, failOperation: vi.fn(() => Promise.resolve()),
    } as unknown as AppDatabase;
    await expect(new AppOperationExecutor(database, {} as ArtifactStore, config, { aiProvider: () => ({ name: 'test', modelId: 'model', generate }) }).execute(stale.id)).rejects.toBeInstanceOf(TerminalOperationError);
    expect(generate).not.toHaveBeenCalled();
    expect(createArtifact).not.toHaveBeenCalled();
  });

  it('changes only design.css for a presentation edit', async () => {
    const next = { ...DEFAULT_DESIGN_V2, theme: { ...DEFAULT_DESIGN_V2.theme, typography: { ...DEFAULT_DESIGN_V2.theme.typography, scale: 'large' as const } } };
    const apply = operation('55555555-5555-4555-8555-555555555555');
    apply.type = 'apply_design'; apply.payload.design = next;
    const database = {
      claimOperation: vi.fn(() => Promise.resolve(apply)), getBlog: vi.fn(() => Promise.resolve(blog)),
      getActiveDesign: vi.fn(() => Promise.resolve(theme)), updateOperationProgress: vi.fn(() => Promise.resolve()),
      createArtifact: vi.fn(() => Promise.resolve({ id: 'css-draft' })), completeDesignOperation: vi.fn(() => Promise.resolve({ ...theme, config: next })),
      markArtifactCleanup: vi.fn(() => Promise.resolve()),
    } as unknown as AppDatabase;
    const copyArtifact = vi.fn(() => Promise.resolve());
    const putObject = vi.fn(() => Promise.resolve());
    const materializeArtifact = vi.fn();
    const artifacts = { copyArtifact, putObject, materializeArtifact } as unknown as ArtifactStore;
    vi.mocked(buildBlog).mockClear();
    await new AppOperationExecutor(database, artifacts, config).execute(apply.id);
    expect(copyArtifact).toHaveBeenCalledWith('draft', 'css-draft');
    expect(putObject).toHaveBeenCalledWith('css-draft', 'design.css', expect.stringContaining('font'), { contentType: 'text/css; charset=utf-8' });
    expect(materializeArtifact).not.toHaveBeenCalled();
    expect(buildBlog).not.toHaveBeenCalled();
  });

  it('does not create a revision or artifact for an unchanged design', async () => {
    const apply = operation('66666666-6666-4666-8666-666666666666');
    apply.type = 'apply_design'; apply.payload.design = DEFAULT_DESIGN_V2;
    const createArtifact = vi.fn(); const completeNoopDesignOperation = vi.fn(() => Promise.resolve(theme));
    const database = { claimOperation: vi.fn(() => Promise.resolve(apply)), getBlog: vi.fn(() => Promise.resolve(blog)), getActiveDesign: vi.fn(() => Promise.resolve(theme)), createArtifact, completeNoopDesignOperation } as unknown as AppDatabase;
    await expect(new AppOperationExecutor(database, {} as ArtifactStore, config).execute(apply.id)).resolves.toMatchObject({ message: 'Design unchanged', revisionId: theme.id });
    expect(createArtifact).not.toHaveBeenCalled();
  });

  it('keeps the saved revision when AI returns an unchanged design', async () => {
    const ai = operation('99999999-9999-4999-8999-999999999999');
    const createArtifact = vi.fn(); const completeNoopDesignOperation = vi.fn(() => Promise.resolve(theme));
    const generate = vi.fn<AiProvider['generate']>(() => Promise.resolve(DEFAULT_DESIGN_V2));
    const database = {
      claimOperation: vi.fn(() => Promise.resolve(ai)), getBlog: vi.fn(() => Promise.resolve(blog)),
      getActiveDesign: vi.fn(() => Promise.resolve(theme)), updateOperationProgress: vi.fn(() => Promise.resolve()),
      createArtifact, completeNoopDesignOperation,
    } as unknown as AppDatabase;
    await expect(new AppOperationExecutor(database, {} as ArtifactStore, config, { aiProvider: () => ({ name: 'test', modelId: 'model', generate }) }).execute(ai.id)).resolves.toMatchObject({ message: 'Design unchanged', revisionId: theme.id });
    expect(generate).toHaveBeenCalledOnce();
    expect(completeNoopDesignOperation).toHaveBeenCalledOnce();
    expect(createArtifact).not.toHaveBeenCalled();
  });

  it('reuses an exact structural build without materializing source or running Astro', async () => {
    const apply = operation('77777777-7777-4777-8777-777777777777');
    apply.type = 'apply_design'; apply.payload.design = historicalTheme.config;
    const buildKey = structuralBuildIdentity('source', historicalTheme.config, 'https://writer.vibelog.org');
    const database = {
      claimOperation: vi.fn(() => Promise.resolve(apply)), getBlog: vi.fn(() => Promise.resolve(blog)), getActiveDesign: vi.fn(() => Promise.resolve(theme)),
      listBuildCacheCandidates: vi.fn(() => Promise.resolve(['old-release'])),
      createArtifact: vi.fn(() => Promise.resolve({ id: 'cached-draft' })), completeDesignOperation: vi.fn(() => Promise.resolve(historicalTheme)),
      markArtifactCleanup: vi.fn(() => Promise.resolve()),
    } as unknown as AppDatabase;
    const copyArtifact = vi.fn(() => Promise.resolve());
    const materializeArtifact = vi.fn();
    const artifacts = { copyArtifact, materializeArtifact, readObject: vi.fn(() => Promise.resolve({ body: new Response(JSON.stringify({ identity: buildKey })).body })) } as unknown as ArtifactStore;
    vi.mocked(buildBlog).mockClear();
    await new AppOperationExecutor(database, artifacts, config).execute(apply.id);
    expect(copyArtifact).toHaveBeenCalledWith('old-release', 'cached-draft');
    expect(materializeArtifact).not.toHaveBeenCalled();
    expect(buildBlog).not.toHaveBeenCalled();
  });

  it.each(['Astro build', 'artifact upload'] as const)('keeps the current draft when %s fails', async (failure) => {
    const generate = vi.fn<AiProvider['generate']>(() => Promise.resolve(historicalTheme.config));
    const completeDesignOperation = vi.fn();
    const markArtifactCleanup = vi.fn(() => Promise.resolve());
    const failOperation = vi.fn(() => Promise.resolve());
    const database = {
      claimOperation: vi.fn(() => Promise.resolve(operation('11111111-1111-4111-8111-111111111111'))),
      getBlog: vi.fn(() => Promise.resolve(blog)),
      updateOperationProgress: vi.fn(() => Promise.resolve()),
      getActiveDesign: vi.fn(() => Promise.resolve(theme)),
      listBuildCacheCandidates: vi.fn(() => Promise.resolve([])),
      createArtifact: vi.fn(() => Promise.resolve({ id: 'candidate-draft' })),
      completeDesignOperation,
      markArtifactCleanup,
      failOperation,
    } as unknown as AppDatabase;
    const materializeArtifact = vi.fn(() => Promise.resolve());
    const uploadDirectory = vi.fn(() => Promise.resolve());
    const artifacts = { materializeArtifact, uploadDirectory } as unknown as ArtifactStore;
    if (failure === 'Astro build') vi.mocked(buildBlog).mockRejectedValueOnce(new Error('Astro failed'));
    else uploadDirectory.mockRejectedValueOnce(new Error('R2 failed'));
    const executor = new AppOperationExecutor(database, artifacts, config, {
      aiProvider: () => ({ name: 'test', modelId: 'model', generate }),
    });

    await expect(executor.execute('11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(TerminalOperationError);

    expect(completeDesignOperation).not.toHaveBeenCalled();
    expect(markArtifactCleanup).toHaveBeenCalledWith('candidate-draft');
    expect(blog.draftArtifactId).toBe('draft');
    expect(blog.draftDesignRevisionId).toBe('theme');
  });

  it('rebuilds a historical design from the current source without AI or HackMD', async () => {
    const activate = operation('33333333-3333-4333-8333-333333333333');
    activate.type = 'activate_design';
    activate.payload = {
      designRevisionId: historicalTheme.id,
      sourceArtifactId: blog.sourceArtifactId,
      draftArtifactId: blog.draftArtifactId,
      draftDesignRevisionId: blog.draftDesignRevisionId,
      contentVersion: blog.contentVersion,
    };
    const generate = vi.fn<AiProvider['generate']>();
    const getDesignRevision = vi.fn(() => Promise.resolve(historicalTheme));
    const completeDesignOperation = vi.fn(() => Promise.resolve(historicalTheme));
    const database = {
      claimOperation: vi.fn(() => Promise.resolve(activate)),
      getBlog: vi.fn(() => Promise.resolve(blog)),
      getDesignRevision,
      getActiveDesign: vi.fn(() => Promise.resolve(theme)),
      listBuildCacheCandidates: vi.fn(() => Promise.resolve([])),
      updateOperationProgress: vi.fn(() => Promise.resolve()),
      createArtifact: vi.fn(() => Promise.resolve({ id: 'historical-draft' })),
      completeDesignOperation,
      markArtifactCleanup: vi.fn(() => Promise.resolve()),
    } as unknown as AppDatabase;
    const materializeArtifact = vi.fn(() => Promise.resolve());
    const artifacts = {
      materializeArtifact,
      uploadDirectory: vi.fn(() => Promise.resolve()),
    } as unknown as ArtifactStore;
    const executor = new AppOperationExecutor(database, artifacts, config, {
      aiProvider: () => ({ name: 'test', modelId: 'model', generate }),
    });

    await expect(executor.execute(activate.id)).resolves.toMatchObject({ revisionId: historicalTheme.id });

    expect(getDesignRevision).toHaveBeenCalledWith(historicalTheme.id, blog.id);
    expect(materializeArtifact).toHaveBeenCalledWith(blog.sourceArtifactId, expect.any(String));
    expect(buildBlog).toHaveBeenCalledWith(expect.objectContaining({ design: historicalTheme.config }));
    expect(generate).not.toHaveBeenCalled();
    expect(completeDesignOperation).toHaveBeenCalledWith(activate, historicalTheme.config, 'historical-draft', expect.any(Object));
  });

  it('publishes by copying the fenced draft without rebuilding or calling AI', async () => {
    const publish = operation('44444444-4444-4444-8444-444444444444');
    publish.type = 'publish';
    publish.payload = {
      contentVersion: blog.contentVersion,
      designRevisionId: blog.draftDesignRevisionId,
      draftArtifactId: blog.draftArtifactId,
    };
    const copyArtifact = vi.fn(() => Promise.resolve());
    const generate = vi.fn<AiProvider['generate']>();
    const database = {
      claimOperation: vi.fn(() => Promise.resolve(publish)),
      getBlog: vi.fn(() => Promise.resolve(blog)),
      updateOperationProgress: vi.fn(() => Promise.resolve()),
      createArtifact: vi.fn(() => Promise.resolve({ id: 'release' })),
      completePublishOperation: vi.fn(() => Promise.resolve()),
      markArtifactCleanup: vi.fn(() => Promise.resolve()),
    } as unknown as AppDatabase;
    const artifacts = { copyArtifact } as unknown as ArtifactStore;
    const executor = new AppOperationExecutor(database, artifacts, config, {
      aiProvider: () => ({ name: 'test', modelId: 'model', generate }),
    });
    vi.mocked(buildBlog).mockClear();

    await expect(executor.execute(publish.id)).resolves.toMatchObject({ message: 'Site published' });

    expect(copyArtifact).toHaveBeenCalledWith('draft', 'release');
    expect(buildBlog).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('distinguishes provider failures from invalid theme responses', () => {
    const providerMessage = operationPublicError('generate_design', new AiProviderRequestError('AI provider request failed'));
    const timeoutMessage = operationPublicError('generate_design', new AiProviderTimeoutError());
    const validationMessage = operationPublicError('generate_design', new Error('Invalid design'));
    expect(providerMessage).toContain('temporarily unavailable');
    expect(timeoutMessage).toContain('too long to respond');
    expect(validationMessage).toContain('valid design');
  });
});
