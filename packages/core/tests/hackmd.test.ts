import { afterEach, describe, expect, it, vi } from 'vitest';
import { HackMdSource, HackMdSourceError } from '../src/adapters/content/hackmd.js';

interface NoteSeed {
  id: string;
  title?: string;
  tags?: string[];
  lastchangeAt?: string;
  publishType?: string;
  publishedAt?: string;
  permalink?: string;
}

function note(id: string, overrides: Partial<NoteSeed> = {}): NoteSeed {
  return {
    id,
    title: `Post ${id}`,
    tags: [],
    lastchangeAt: '',
    publishType: 'view',
    publishedAt: '2026-01-02T00:00:00Z',
    permalink: `post-${id}`,
    ...overrides,
  };
}

function overview(notes: NoteSeed[]): Response {
  return Response.json({ notes });
}

function fetchUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HackMdSource', () => {
  it('imports only public published notes and sanitizes content', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = fetchUrl(input);
      if (url.endsWith('/overview')) return Promise.resolve(overview([
        note('one', { title: 'Hello', tags: ['Writing'], lastchangeAt: '2026-01-03T12:00:00Z', permalink: 'hello' }),
        note('draft', { title: 'Draft', publishType: 'edit', publishedAt: '' }),
      ]));
      return Promise.resolve(new Response('# Hello\n<script>x</script>'));
    }));
    await expect(new HackMdSource('writer').getPosts()).resolves.toEqual({ posts: [{ id: 'one', title: 'Hello', slug: 'hello', date: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-03T12:00:00.000Z', tags: ['Writing'], content: '&lt;script&gt;x&lt;/script&gt;' }] });
  });

  it('keeps same-day modifications, ignores earlier ones, and defaults missing tags', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => Promise.resolve(fetchUrl(input).endsWith('/overview')
      ? overview([
        note('same-day', { tags: undefined, lastchangeAt: '2026-01-02T18:00:00Z' }),
        note('earlier', { lastchangeAt: '2026-01-01T00:00:00Z' }),
      ])
      : new Response('body'))));
    const result = await new HackMdSource('writer').getPosts();
    expect(result.posts[0]).toMatchObject({ id: 'same-day', tags: [], updatedAt: '2026-01-02T18:00:00.000Z' });
    expect(result.posts[1]).toMatchObject({ id: 'earlier', tags: [] });
    expect(result.posts[1]).not.toHaveProperty('updatedAt');
  });

  it('validates dates and duplicate slugs before downloading article bodies', async () => {
    const invalidDateFetch = vi.fn((input: string | URL | Request) => Promise.resolve(fetchUrl(input).endsWith('/overview')
      ? overview([note('broken', { lastchangeAt: 'not-a-date' })])
      : new Response('secret article body')));
    vi.stubGlobal('fetch', invalidDateFetch);
    await expect(new HackMdSource('writer').getPosts()).rejects.toMatchObject({ code: 'invalid_modified_date' });
    expect(invalidDateFetch).toHaveBeenCalledOnce();

    const duplicateFetch = vi.fn(() => Promise.resolve(overview([
      note('one', { permalink: 'same' }),
      note('two', { permalink: 'same' }),
    ])));
    vi.stubGlobal('fetch', duplicateFetch);
    await expect(new HackMdSource('writer').getPosts()).rejects.toMatchObject({ code: 'duplicate_slug' });
    expect(duplicateFetch).toHaveBeenCalledOnce();
  });

  it('rejects empty publications and invalid response shapes', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(overview([]))));
    await expect(new HackMdSource('writer').getPosts()).rejects.toMatchObject({ code: 'no_public_articles' });

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"secret":"response body"}'))));
    const error = await new HackMdSource('writer').getPosts().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'invalid_response' });
    expect(String(error)).not.toContain('response body');

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ neither: 'profile nor team' }))));
    await expect(new HackMdSource('writer').getAuthor()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('downloads at most four articles concurrently and preserves overview order', async () => {
    let active = 0;
    let maxActive = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = fetchUrl(input);
      if (url.endsWith('/overview')) return overview(Array.from({ length: 9 }, (_, index) => note(String(index))));
      const id = url.split('/').at(-2) ?? '';
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, (9 - Number(id)) % 4));
      active -= 1;
      return new Response(`Body ${id}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new HackMdSource('writer').getPosts();

    expect(maxActive).toBe(4);
    expect(result.posts.map((post) => post.id)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
    expect(result.posts.map((post) => post.content)).toEqual(['Body 0', 'Body 1', 'Body 2', 'Body 3', 'Body 4', 'Body 5', 'Body 6', 'Body 7', 'Body 8']);
  });

  it('retries network errors, rate limits, and temporary server failures at most three times', async () => {
    vi.useFakeTimers();
    for (const failure of ['network', '429', '503'] as const) {
      let attempts = 0;
      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = fetchUrl(input);
        if (url.endsWith('/overview')) {
          attempts += 1;
          if (attempts < 3) {
            if (failure === 'network') return Promise.reject(new TypeError('network unavailable'));
            return Promise.resolve(new Response(null, { status: Number(failure), headers: { 'Retry-After': '0' } }));
          }
          return Promise.resolve(overview([note('one')]));
        }
        return Promise.resolve(new Response('body'));
      });
      vi.stubGlobal('fetch', fetchMock);
      const result = new HackMdSource('writer').getPosts();
      const assertion = expect(result).resolves.toMatchObject({ posts: [{ id: 'one' }] });
      await vi.runAllTimersAsync();
      await assertion;
      expect(attempts).toBe(3);
    }
  });

  it('does not retry permanent client errors or missing resources', async () => {
    for (const [status, code] of [[400, 'request_rejected'], [401, 'request_rejected'], [404, 'profile_not_found']] as const) {
      const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status })));
      vi.stubGlobal('fetch', fetchMock);
      await expect(new HackMdSource('writer').getPosts()).rejects.toMatchObject({ code });
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  });

  it('honors Retry-After seconds and HTTP dates while capping waits at five seconds', async () => {
    vi.useFakeTimers();
    for (const retryAfter of ['20', 'Thu, 01 Jan 2026 00:00:02 GMT']) {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      let attempts = 0;
      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = fetchUrl(input);
        if (!url.endsWith('/overview')) return Promise.resolve(new Response('body'));
        attempts += 1;
        return Promise.resolve(attempts === 1
          ? new Response(null, { status: 429, headers: { 'Retry-After': retryAfter } })
          : overview([note('one')]));
      });
      vi.stubGlobal('fetch', fetchMock);
      const result = new HackMdSource('writer').getPosts();
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(1);
      const expectedDelay = retryAfter === '20' ? 5_000 : 2_000;
      await vi.advanceTimersByTimeAsync(expectedDelay - 1);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toMatchObject({ posts: [{ id: 'one' }] });
      expect(attempts).toBe(2);
    }
  });

  it('times out each attempt and stops after the third request', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new Error('request aborted', { cause: init.signal?.reason }));
      }, { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = new HackMdSource('writer').getPosts();
    const assertion = expect(result).rejects.toMatchObject({ code: 'request_timeout' });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a response stream that fails during download', async () => {
    vi.useFakeTimers();
    let articleAttempts = 0;
    const fetchMock = vi.fn((input: string | URL | Request) => {
      if (fetchUrl(input).endsWith('/overview')) return Promise.resolve(overview([note('one')]));
      articleAttempts += 1;
      if (articleAttempts < 3) {
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial secret body'));
            controller.error(new Error('stream disconnected'));
          },
        })));
      }
      return Promise.resolve(new Response('complete body'));
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = new HackMdSource('writer').getPosts();
    const assertion = expect(result).resolves.toMatchObject({ posts: [{ content: 'complete body' }] });
    await vi.runAllTimersAsync();
    await assertion;
    expect(articleAttempts).toBe(3);
  });

  it('enforces article limits with declared, missing, and misleading Content-Length headers', async () => {
    const oversized = 'x'.repeat(2 * 1024 * 1024 + 1);
    const headerCases: HeadersInit[] = [{ 'Content-Length': String(oversized.length) }, {}, { 'Content-Length': '1' }];
    for (const headers of headerCases) {
      const fetchMock = vi.fn((input: string | URL | Request) => Promise.resolve(fetchUrl(input).endsWith('/overview')
        ? overview([note('large')])
        : new Response(oversized, { headers })));
      vi.stubGlobal('fetch', fetchMock);
      await expect(new HackMdSource('writer').getPosts()).rejects.toMatchObject({ code: 'article_too_large' });
    }
  });

  it('enforces profile, overview, article-count, and aggregate body limits', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ user: { displayName: 'Writer', biography: 'x'.repeat(256 * 1024) } }))));
    await expect(new HackMdSource('writer').getAuthor()).rejects.toMatchObject({ code: 'metadata_too_large' });

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ notes: [], padding: 'x'.repeat(2 * 1024 * 1024) }))));
    await expect(new HackMdSource('writer').getPosts()).rejects.toMatchObject({ code: 'metadata_too_large' });

    const tooMany = Array.from({ length: 201 }, (_, index) => note(String(index)));
    const countFetch = vi.fn(() => Promise.resolve(overview(tooMany)));
    vi.stubGlobal('fetch', countFetch);
    await expect(new HackMdSource('writer').getPosts()).rejects.toMatchObject({ code: 'too_many_articles' });
    expect(countFetch).toHaveBeenCalledOnce();

    const body = 'x'.repeat(2 * 1024 * 1024);
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => Promise.resolve(fetchUrl(input).endsWith('/overview')
      ? overview(Array.from({ length: 17 }, (_, index) => note(String(index))))
      : new Response(body))));
    await expect(new HackMdSource('writer').getPosts()).rejects.toMatchObject({ code: 'sync_too_large' });
  });

  it('cancels remaining downloads after a permanent article failure', async () => {
    let aborted = 0;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = fetchUrl(input);
      if (url.endsWith('/overview')) return Promise.resolve(overview(Array.from({ length: 6 }, (_, index) => note(String(index)))));
      if (url.endsWith('/0/download')) return Promise.resolve(new Response(null, { status: 404 }));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted += 1;
          reject(new Error('request aborted', { cause: init.signal?.reason }));
        }, { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(new HackMdSource('writer').getPosts()).rejects.toMatchObject({ code: 'article_not_found' });
    expect(aborted).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([input]) => fetchUrl(input as string).endsWith('/4/download'))).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => fetchUrl(input as string).endsWith('/5/download'))).toBe(false);
  });

  it('never includes an external response body in structured errors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('credential=should-not-leak', { status: 503 }))));
    vi.useFakeTimers();
    const result = new HackMdSource('writer').getPosts();
    const errorPromise = result.catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await errorPromise;
    expect(error).toBeInstanceOf(HackMdSourceError);
    expect(String(error)).not.toContain('should-not-leak');
  });
});
