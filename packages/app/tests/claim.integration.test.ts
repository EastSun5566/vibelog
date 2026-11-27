import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DESIGN_V2 } from '@vibelog/core';
import { eq, inArray, like } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { emailRateLimitKey } from '../src/auth.js';
import { loadAppConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import { applyDesignPreset } from '../src/design-presets.js';
import { createApp } from '../src/index.js';
import type { ArtifactStore } from '../src/ports/artifact-store.js';
import type { TransactionalEmailSender } from '../src/ports/transactional-email.js';
import { ProfilePreviewStore, previewNameKey } from '../src/profile-preview.js';
import {
  blogs,
  profilePreviews,
  rateLimit,
  themeRevisions,
  user,
  verification,
} from '../src/schema.js';

const url = process.env.TEST_DATABASE_URL;
const apiUrl = 'https://api.hackmd.test/v1';

describe.skipIf(!url)('claiming /@name with a HackMD token', () => {
  const config = loadAppConfig({
    APP_ORIGIN: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgresql://unused',
    BETTER_AUTH_SECRET: 'claim-test-secret-at-least-thirty-two-characters',
    OBJECT_STORE_ENDPOINT: 'http://localhost:9000',
    OBJECT_STORE_BUCKET: 'unused',
    OBJECT_STORE_ACCESS_KEY_ID: 'unused',
    OBJECT_STORE_SECRET_ACCESS_KEY: 'unused',
    EMAIL_PROVIDER: 'mailpit',
    MAILPIT_API_URL: 'http://localhost:8025',
    EMAIL_FROM: 'login@example.com',
    HACKMD_API_URL: apiUrl,
  });
  const database = new AppDatabase(config.databaseUrl);
  const previews = new ProfilePreviewStore(database);
  const send = vi.fn<TransactionalEmailSender['sendMagicLink']>(() => Promise.resolve());
  const { app } = createApp({
    config,
    database,
    artifactStore: {} as ArtifactStore,
    emailSender: { sendMagicLink: send },
    dispatcher: { dispatch: () => Promise.resolve(0) },
  });
  const headers = { Host: 'localhost:3000', Origin: config.appOrigin };
  const emails: string[] = [];
  const names: string[] = [];
  /** Tokens are named after the HackMD account that owns them. */
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const target = input instanceof Request ? input.url : String(input);
    if (!target.startsWith(apiUrl)) return realFetch(input, init);
    const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /u, '');
    if (!token?.startsWith('token-for-'))
      return Promise.resolve(new Response(null, { status: 401 }));
    return Promise.resolve(Response.json({ userPath: token.slice('token-for-'.length) }));
  });

  const signIn = async () => {
    const address = `${randomUUID()}@example.com`;
    emails.push(address);
    await app.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: address, callbackURL: '/editor' }),
    });
    const link = send.mock.calls.find(([input]) => input.to === address)?.[0].url;
    if (!link) throw new Error('Missing sign-in link');
    const cookie = (await app.request(link, { headers })).headers
      .getSetCookie()
      .find((value) => value.startsWith('vibelog.session_token='))
      ?.split(';')[0];
    if (!cookie) throw new Error('Missing session cookie');
    const session = (await (
      await app.request('/api/session', { headers: { ...headers, Cookie: cookie } })
    ).json()) as { user: { id: string }; csrfToken: string };
    return { cookie, csrfToken: session.csrfToken, userId: session.user.id };
  };
  const hackmdName = () => {
    const name = `Writer${randomUUID().slice(0, 8)}`;
    names.push(previewNameKey(name));
    return name;
  };
  const claim = (
    name: string,
    writer: { cookie: string; csrfToken: string },
    fields: Record<string, string>,
  ) =>
    app.request(`/@${name}/edit`, {
      method: 'POST',
      headers: { ...headers, Cookie: writer.cookie },
      body: new URLSearchParams({ csrfToken: writer.csrfToken, language: 'en', ...fields }),
    });

  beforeAll(() =>
    migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../src/drizzle', import.meta.url)),
    }),
  );
  afterAll(async () => {
    vi.restoreAllMocks();
    for (const address of emails) {
      const key = emailRateLimitKey(config.betterAuthSecret, address);
      await database.db
        .delete(rateLimit)
        .where(inArray(rateLimit.key, [`magic:minute:${key}`, `magic:hour:${key}`]));
      await database.db.delete(verification).where(like(verification.value, `%${address}%`));
      await database.db.delete(user).where(eq(user.email, address));
    }
    if (names.length > 0)
      await database.db.delete(profilePreviews).where(inArray(profilePreviews.nameKey, names));
    await database.close();
  });

  it('sends visitors to sign in and back to the claim page', async () => {
    const name = hackmdName();
    const response = await app.request(`/@${name}/edit`, { headers });
    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    expect(location).toBe(`/auth/login?returnTo=${encodeURIComponent(`/@${name}/edit`)}`);
    const login = await (await app.request(location, { headers })).text();
    expect(login).toContain(`value="/@${name}/edit"`);
  });

  it('verifies the token owner, then creates the blog with the preview design', async () => {
    const name = hackmdName();
    const created = await previews.create(name);
    const lease = created && (await previews.claim(created.id));
    if (!lease) throw new Error('Preview was not claimed');
    const aiDesign = applyDesignPreset(DEFAULT_DESIGN_V2, 'night');
    await previews.complete(lease, {
      sourceArtifactId: randomUUID(),
      draftArtifactId: randomUUID(),
      design: aiDesign,
      designSource: 'ai',
      language: 'zh-Hant',
      title: 'Blog',
      author: 'Writer',
      contentProfile: {
        postCount: 1,
        tagCount: 0,
        averageLength: 'short',
        codeUsage: 'none',
        imageUsage: 'none',
        mathUsage: 'none',
      },
    });
    const writer = await signIn();
    const page = await (
      await app.request(`/@${name}/edit`, { headers: { ...headers, Cookie: writer.cookie } })
    ).text();
    expect(page).toContain(`Make @${name} yours`);
    expect(page).toContain(`value="${previewNameKey(name)}"`);
    expect(page).toContain('value="zh-Hant"');

    const handle = previewNameKey(name);
    const wrongOwner = await claim(name, writer, {
      hackmdToken: 'token-for-someone',
      username: handle,
    });
    expect(wrongOwner.status).toBe(403);
    expect(await wrongOwner.text()).toContain('This token belongs to @someone');
    const rejected = await claim(name, writer, {
      hackmdToken: 'not-a-real-token',
      username: handle,
    });
    expect(rejected.status).toBe(403);
    expect(await rejected.text()).not.toContain('not-a-real-token');

    // HackMD paths are case-insensitive, so the token owner may differ in case.
    const accepted = await claim(name, writer, {
      hackmdToken: `token-for-${name.toUpperCase()}`,
      username: handle,
    });
    expect(accepted.status).toBe(303);
    const [blog] = await database.db.select().from(blogs).where(eq(blogs.userId, writer.userId));
    expect(blog).toMatchObject({ username: handle, language: 'en' });
    expect(blog?.hackmdVerifiedAt).toBeInstanceOf(Date);
    const [theme] = await database.db
      .select()
      .from(themeRevisions)
      .where(eq(themeRevisions.blogId, blog?.id ?? ''));
    expect(theme).toMatchObject({ config: aiDesign, source: 'ai', active: true });
    expect(
      (
        await app.request(`/@${name}/edit`, { headers: { ...headers, Cookie: writer.cookie } })
      ).headers.get('location'),
    ).toBe('/editor');

    const rival = await signIn();
    const taken = await claim(name, rival, {
      hackmdToken: `token-for-${name}`,
      username: `${handle}-2`,
    });
    expect(taken.status).toBe(409);
    expect(await taken.text()).toContain('is already claimed');
  });

  it('rejects a reserved blog address and a missing CSRF token', async () => {
    const name = hackmdName();
    const writer = await signIn();
    const reserved = await claim(name, writer, {
      hackmdToken: `token-for-${name}`,
      username: 'try-0123456789ab',
    });
    expect(reserved.status).toBe(400);
    const forged = await app.request(`/@${name}/edit`, {
      method: 'POST',
      headers: { ...headers, Cookie: writer.cookie },
      body: new URLSearchParams({ hackmdToken: `token-for-${name}`, username: 'fine-name' }),
    });
    expect(forged.status).toBe(403);
    expect((await app.request('/@%E0%A4%A/edit', { headers })).status).toBe(404);
  });
});
