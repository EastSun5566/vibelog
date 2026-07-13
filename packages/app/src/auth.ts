import * as oidc from 'openid-client';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppConfig } from './config.js';
import type { AppDatabase, SessionRecord } from './database.js';
import { hashToken, randomToken } from './security/crypto.js';

const FLOW_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface AppVariables {
  requestId: string;
  session: SessionRecord;
  cspNonce: string;
}

export type AppContext = Context<{ Variables: AppVariables }>;

function sessionCookieName(config: AppConfig): string {
  return config.secureCookies ? '__Host-vibelog_session' : 'vibelog_session';
}

export function readSession(c: Context, database: AppDatabase, config: AppConfig): SessionRecord | null {
  const token = getCookie(c, sessionCookieName(config));
  return token ? database.getSession(hashToken(token)) : null;
}

export function setSession(c: Context, database: AppDatabase, config: AppConfig, userId: string): SessionRecord {
  const token = randomToken();
  const csrfToken = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  database.createSession(hashToken(token), userId, csrfToken, expiresAt);
  setCookie(c, sessionCookieName(config), token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  const session = database.getSession(hashToken(token));
  if (!session) throw new Error('Failed to create session');
  return session;
}

export function clearSession(c: Context, database: AppDatabase, config: AppConfig): void {
  const token = getCookie(c, sessionCookieName(config));
  if (token) database.deleteSession(hashToken(token));
  setCookie(c, sessionCookieName(config), '', {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax',
    path: '/',
    maxAge: 0,
  });
}

export class OidcService {
  private configuration?: Promise<oidc.Configuration>;

  constructor(
    private readonly database: AppDatabase,
    private readonly settings: NonNullable<AppConfig['oidc']>,
  ) {}

  private getConfiguration(): Promise<oidc.Configuration> {
    this.configuration ??= oidc.discovery(
      this.settings.issuer,
      this.settings.clientId,
      this.settings.clientSecret,
    );
    return this.configuration;
  }

  async authorizationUrl(): Promise<URL> {
    const configuration = await this.getConfiguration();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    this.database.createOidcFlow(
      state,
      codeVerifier,
      nonce,
      new Date(Date.now() + FLOW_TTL_MS).toISOString(),
    );

    return oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.settings.redirectUri,
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });
  }

  async finish(callbackUrl: URL) {
    const state = callbackUrl.searchParams.get('state');
    if (!state) throw new Error('Missing OIDC state');
    const flow = this.database.takeOidcFlow(state);
    if (!flow) throw new Error('OIDC flow expired or already used');

    const configuration = await this.getConfiguration();
    const tokens = await oidc.authorizationCodeGrant(configuration, callbackUrl, {
      pkceCodeVerifier: flow.codeVerifier,
      expectedState: state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims?.sub) throw new Error('OIDC provider did not return a subject');

    return this.database.upsertUser({
      issuer: claims.iss,
      subject: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : null,
      displayName: typeof claims.name === 'string' ? claims.name : null,
    });
  }
}
