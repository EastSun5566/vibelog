import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const oidc = vi.hoisted(() => ({
  discovery: vi.fn(),
  randomPKCECodeVerifier: vi.fn(() => 'verifier'),
  calculatePKCECodeChallenge: vi.fn(() => Promise.resolve('challenge')),
  randomState: vi.fn(() => 'state'),
  randomNonce: vi.fn(() => 'nonce'),
  buildAuthorizationUrl: vi.fn(() => new URL('https://issuer.test/authorize?state=state')),
  authorizationCodeGrant: vi.fn(),
}));

vi.mock('openid-client', () => oidc);

import { OidcService } from '../src/auth.js';
import { AppDatabase } from '../src/database.js';

describe('OIDC Authorization Code + PKCE boundary', () => {
  let root: string;
  let database: AppDatabase;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vibelog-oidc-'));
    database = new AppDatabase(root);
    oidc.discovery.mockResolvedValue({});
    oidc.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({
        iss: 'https://issuer.test',
        sub: 'subject-1',
        email: 'person@example.test',
        name: 'Test Person',
      }),
    });
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('binds PKCE, state, and nonce and prevents callback replay', async () => {
    const service = new OidcService(database, {
      issuer: new URL('https://issuer.test'),
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://app.test/auth/callback',
    });

    await expect(service.authorizationUrl()).resolves.toEqual(new URL('https://issuer.test/authorize?state=state'));
    expect(oidc.calculatePKCECodeChallenge).toHaveBeenCalledWith('verifier');
    expect(oidc.buildAuthorizationUrl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      state: 'state',
      nonce: 'nonce',
    }));

    const callback = new URL('https://app.test/auth/callback?code=authorization-code&state=state');
    await expect(service.finish(callback)).resolves.toMatchObject({
      issuer: 'https://issuer.test',
      subject: 'subject-1',
      email: 'person@example.test',
    });
    expect(oidc.authorizationCodeGrant).toHaveBeenCalledWith(expect.anything(), callback, {
      pkceCodeVerifier: 'verifier',
      expectedState: 'state',
      expectedNonce: 'nonce',
      idTokenExpected: true,
    });
    await expect(service.finish(callback)).rejects.toThrow('expired or already used');
  });
});
