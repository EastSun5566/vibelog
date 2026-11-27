import { ContentSourceName, DEFAULT_DESIGN_V2, HackMdSourceError } from '@vibelog/core';
import type { AiProvider, ContentProfile, ContentSource } from '@vibelog/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyDesignPreset } from '../src/design-presets.js';
import type { ArtifactStore } from '../src/ports/artifact-store.js';
import { PREVIEW_DESIGN_PROMPT, ProfilePreviewExecutor } from '../src/profile-preview-jobs.js';
import {
  PreviewLeaseLostError,
  type ProfilePreviewRecord,
  type ProfilePreviewStore,
  guessLanguage,
  hackmdNameSchema,
  isPreviewLabel,
  isReservedBlogHandle,
  pickPreset,
  previewLabel,
  previewNameKey,
  previewSiteOrigin,
  previewVisitAction,
} from '../src/profile-preview.js';

vi.mock('@vibelog/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vibelog/core')>();
  return { ...actual, buildBlog: vi.fn(() => Promise.resolve()) };
});
afterEach(() => vi.clearAllMocks());

const profile = (overrides: Partial<ContentProfile> = {}): ContentProfile => ({
  postCount: 4,
  tagCount: 2,
  averageLength: 'medium',
  codeUsage: 'none',
  imageUsage: 'none',
  mathUsage: 'none',
  ...overrides,
});
const at = new Date('2026-11-27T12:00:00.000Z');
const record = (overrides: Partial<ProfilePreviewRecord> = {}): ProfilePreviewRecord => ({
  id: 'preview',
  nameKey: 'alice',
  hackmdUsername: 'Alice',
  label: previewLabel('alice'),
  state: 'building',
  stage: 'Reading HackMD',
  generation: 1,
  attempts: 1,
  leaseExpiresAt: new Date(at.getTime() + 60_000).toISOString(),
  sourceArtifactId: null,
  draftArtifactId: null,
  design: null,
  designSource: null,
  title: null,
  author: null,
  contentProfile: null,
  errorMessage: null,
  generatedAt: null,
  expiresAt: null,
  updatedAt: at.toISOString(),
  ...overrides,
});

describe('preview naming', () => {
  it('maps a HackMD name to one stable, case-insensitive preview host', () => {
    expect(previewNameKey('EastSun5566')).toBe('eastsun5566');
    const label = previewLabel(previewNameKey('EastSun5566'));
    expect(label).toBe(previewLabel('eastsun5566'));
    expect(isPreviewLabel(label)).toBe(true);
    expect(isPreviewLabel('try-alice')).toBe(false);
    expect(previewSiteOrigin('http://app.localtest.me:3000', label)).toBe(
      `http://${label}.app.localtest.me:3000`,
    );
  });
  it('accepts HackMD names and rejects paths', () => {
    for (const name of ['eastsun5566', 'a.b_c-d', '張三']) expect(hackmdNameSchema.parse(name));
    for (const name of ['', 'a/b', '../x', 'a b'])
      expect(hackmdNameSchema.safeParse(name).success).toBe(false);
  });
  it('keeps blogs off preview hosts and app hosts', () => {
    expect(isReservedBlogHandle(previewLabel('alice'))).toBe(true);
    expect(isReservedBlogHandle('preview')).toBe(true);
    // Existing blogs with other try- handles keep working.
    expect(isReservedBlogHandle('try-anything')).toBe(false);
    expect(isReservedBlogHandle('trying')).toBe(false);
  });
});

describe('starter design', () => {
  it('picks a preset that suits the content', () => {
    expect(pickPreset(profile({ imageUsage: 'frequent', codeUsage: 'frequent' }))).toBe('magazine');
    expect(pickPreset(profile({ codeUsage: 'frequent' }))).toBe('personality');
    expect(pickPreset(profile({ mathUsage: 'frequent' }))).toBe('personality');
    expect(pickPreset(profile({ averageLength: 'long' }))).toBe('readable');
    expect(pickPreset(profile())).toBe('magazine');
  });
  it('guesses the blog language from titles', () => {
    expect(guessLanguage(['用 HackMD 寫部落格', '我的筆記'])).toBe('zh-Hant');
    expect(guessLanguage(['Notes on Rust', 'Weekly log'])).toBe('en');
    expect(guessLanguage(['123'])).toBe('en');
  });
});

describe('what a visit does', () => {
  const minutes = (count: number) => new Date(at.getTime() + count * 60_000).toISOString();
  it('creates a missing preview and serves a fresh one', () => {
    expect(previewVisitAction(null, at)).toBe('create');
    expect(previewVisitAction(record({ state: 'ready', expiresAt: minutes(5) }), at)).toBe('serve');
    expect(previewVisitAction(record({ state: 'ready', expiresAt: minutes(-1) }), at)).toBe(
      'refresh',
    );
  });
  it('waits for running work and resends work nobody picked up', () => {
    expect(previewVisitAction(record({ state: 'queued', updatedAt: minutes(-1) }), at)).toBe(
      'wait',
    );
    expect(previewVisitAction(record({ state: 'queued', updatedAt: minutes(-3) }), at)).toBe(
      'redispatch',
    );
    expect(previewVisitAction(record({ leaseExpiresAt: minutes(1) }), at)).toBe('wait');
    expect(previewVisitAction(record({ leaseExpiresAt: minutes(-1) }), at)).toBe('redispatch');
  });
  it('shows a recent failure and retries an old one', () => {
    expect(previewVisitAction(record({ state: 'failed', updatedAt: minutes(-1) }), at)).toBe(
      'none',
    );
    expect(previewVisitAction(record({ state: 'failed', updatedAt: minutes(-6) }), at)).toBe(
      'refresh',
    );
  });
});

describe('preview builds', () => {
  const source = (getPosts: ContentSource['getPosts']): ContentSource => ({
    name: ContentSourceName.HACKMD,
    getPosts,
    getAuthor: () => Promise.resolve({ name: 'Alice', bio: 'Writes about tea.' }),
  });
  const posts = [
    {
      id: '1',
      title: 'Brewing notes',
      content: '# Brewing\n\nGreen tea at 80°C.',
      slug: 'brewing-notes',
      date: '2026-11-01T00:00:00.000Z',
      tags: ['tea'],
    },
  ];
  function setup(lease: ProfilePreviewRecord | null) {
    const store = {
      claim: vi.fn(() => Promise.resolve(lease)),
      setStage: vi.fn(() => Promise.resolve()),
      complete: vi.fn(() => Promise.resolve(['old-source', 'old-draft'])),
      fail: vi.fn(() => Promise.resolve()),
      consumeAiBudget: vi.fn(() => Promise.resolve(false)),
    };
    const artifacts = {
      uploadDirectory: vi.fn(() => Promise.resolve()),
      deleteArtifact: vi.fn((_id: string) => Promise.resolve()),
    };
    return { store, artifacts };
  }
  const config = {
    appOrigin: 'https://vibelog.example',
    hackmdBaseUrl: 'https://hackmd.io',
    aiProvider: 'openai',
    aiModel: 'gpt-4o-mini',
    aiFallbackModels: [],
    previewAiDailyLimit: 100,
  };

  it('builds with a starter design and removes the previous generation', async () => {
    const { store, artifacts } = setup(record());
    const executor = new ProfilePreviewExecutor(
      store as unknown as ProfilePreviewStore,
      artifacts as unknown as ArtifactStore,
      config,
      { contentSource: () => source(() => Promise.resolve({ posts })) },
    );
    expect(await executor.execute('preview')).toEqual({ message: 'Preview ready' });
    const [, result] = store.complete.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(result).toMatchObject({
      designSource: 'preset',
      title: "Alice's blog",
      author: 'Alice',
      design: applyDesignPreset(DEFAULT_DESIGN_V2, 'magazine'),
    });
    expect(artifacts.uploadDirectory).toHaveBeenCalledTimes(2);
    expect(artifacts.deleteArtifact.mock.calls.map(([id]) => id)).toEqual([
      'old-source',
      'old-draft',
    ]);
  });
  it('asks the AI for a design that fits the posts when the budget allows', async () => {
    const { store, artifacts } = setup(record());
    store.consumeAiBudget.mockResolvedValue(true);
    const aiDesign = applyDesignPreset(DEFAULT_DESIGN_V2, 'night');
    const generate = vi.fn<AiProvider['generate']>(() => Promise.resolve(aiDesign));
    const executor = new ProfilePreviewExecutor(
      store as unknown as ProfilePreviewStore,
      artifacts as unknown as ArtifactStore,
      config,
      {
        contentSource: () => source(() => Promise.resolve({ posts })),
        aiProvider: () => ({ name: 'test', modelId: 'test', generate }),
      },
    );
    await executor.execute('preview');
    const [input] = generate.mock.calls[0] ?? [];
    expect(input).toMatchObject({
      prompt: PREVIEW_DESIGN_PROMPT,
      currentDesign: applyDesignPreset(DEFAULT_DESIGN_V2, 'magazine'),
      samples: [{ title: 'Brewing notes', tags: ['tea'], excerpt: 'Brewing Green tea at 80°C.' }],
    });
    expect(store.setStage).toHaveBeenCalledWith(expect.anything(), 'Designing to match your posts');
    const [, result] = store.complete.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(result).toMatchObject({ design: aiDesign, designSource: 'ai' });
  });
  it('keeps the starter preset when the AI fails or the budget is spent', async () => {
    for (const budget of [true, false]) {
      const { store, artifacts } = setup(record());
      store.consumeAiBudget.mockResolvedValue(budget);
      const generate = vi.fn<AiProvider['generate']>(() =>
        Promise.reject(new Error('provider down')),
      );
      await new ProfilePreviewExecutor(
        store as unknown as ProfilePreviewStore,
        artifacts as unknown as ArtifactStore,
        config,
        {
          contentSource: () => source(() => Promise.resolve({ posts })),
          aiProvider: () => ({ name: 'test', modelId: 'test', generate }),
        },
      ).execute('preview');
      expect(generate).toHaveBeenCalledTimes(budget ? 1 : 0);
      const [, result] = store.complete.mock.calls[0] as unknown as [
        unknown,
        Record<string, unknown>,
      ];
      expect(result).toMatchObject({ designSource: 'preset' });
    }
  });
  it('records the public reason and drops partial uploads when HackMD fails', async () => {
    const lease = record();
    const { store, artifacts } = setup(lease);
    const executor = new ProfilePreviewExecutor(
      store as unknown as ProfilePreviewStore,
      artifacts as unknown as ArtifactStore,
      config,
      {
        contentSource: () =>
          source(() => Promise.reject(new HackMdSourceError('profile_not_found', 'missing'))),
      },
    );
    expect(await executor.execute('preview')).toEqual({ failed: true });
    expect(store.fail).toHaveBeenCalledWith(
      lease,
      'We could not find that public HackMD user. Check the username and try again.',
    );
    expect(store.complete).not.toHaveBeenCalled();
    expect(artifacts.deleteArtifact).toHaveBeenCalledTimes(2);
  });
  it('treats duplicate deliveries and lost leases as no-ops', async () => {
    const idle = setup(null);
    expect(
      await new ProfilePreviewExecutor(
        idle.store as unknown as ProfilePreviewStore,
        idle.artifacts as unknown as ArtifactStore,
        config,
      ).execute('preview'),
    ).toEqual({ duplicate: true });
    const lost = setup(record());
    lost.store.complete.mockRejectedValueOnce(new PreviewLeaseLostError());
    expect(
      await new ProfilePreviewExecutor(
        lost.store as unknown as ProfilePreviewStore,
        lost.artifacts as unknown as ArtifactStore,
        config,
        { contentSource: () => source(() => Promise.resolve({ posts })) },
      ).execute('preview'),
    ).toEqual({ duplicate: true });
    expect(lost.store.fail).not.toHaveBeenCalled();
  });
});
