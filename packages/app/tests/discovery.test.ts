import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { S3ArtifactStore } from '../src/adapters/s3-artifact-store.js';
import { AgentRepository } from '../src/agent/repository.js';
import { agentRoutes } from '../src/agent/routes.js';
import type { AppVariables } from '../src/auth.js';
import { loadAppConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import {
  AGENT_SKILLS_SCHEMA,
  agentSkill,
  agentSkillsIndex,
  apiCatalog,
  llmsTxt,
} from '../src/discovery.js';
import { createApp } from '../src/index.js';

const origin = 'https://vibelog.example';
const baseConfig = loadAppConfig({
  APP_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://unused',
  BETTER_AUTH_SECRET: 'test-auth-secret-at-least-thirty-two-characters',
  OBJECT_STORE_ENDPOINT: 'http://localhost:9000',
  OBJECT_STORE_BUCKET: 'unused',
  OBJECT_STORE_ACCESS_KEY_ID: 'unused',
  OBJECT_STORE_SECRET_ACCESS_KEY: 'unused',
  EMAIL_PROVIDER: 'mailpit',
  MAILPIT_API_URL: 'http://localhost:8025',
  EMAIL_FROM: 'login@example.com',
});
const database = new AppDatabase(baseConfig.databaseUrl);
afterAll(() => database.close());
afterEach(() => vi.restoreAllMocks());

function app(agentCliVersion?: string) {
  return createApp({
    config: { ...baseConfig, agentCliVersion },
    database,
    artifactStore: new S3ArtifactStore(baseConfig.objectStore),
    emailSender: { sendMagicLink: () => Promise.resolve() },
    dispatcher: { dispatch: () => Promise.resolve(0) },
  }).app;
}

/** The agent API alone, with the edge identity a real request would carry. */
function agentApi(canPublish = false) {
  vi.spyOn(AgentRepository.prototype, 'limited').mockResolvedValue();
  vi.spyOn(AgentRepository.prototype, 'grant').mockResolvedValue({
    id: 'grant',
    userId: 'writer',
    expiresAt: new Date('2099-01-01T00:00:00Z'),
    canPublish,
  } as Awaited<ReturnType<AgentRepository['grant']>>);
  const createPairing = vi.spyOn(AgentRepository.prototype, 'createPairing').mockResolvedValue({
    deviceCode: 'd'.repeat(43),
    userCode: 'AABBCCDDEE',
    expiresAt: '2099-01-01T00:00:00.000Z',
    interval: 5,
    canPublish: false,
  });
  const routes = agentRoutes(database, { dispatch: () => Promise.resolve(0) }, origin, {
    betterAuthSecret: baseConfig.betterAuthSecret,
  });
  const parent = new Hono<{ Variables: AppVariables }>();
  parent.use('*', async (c, next) => {
    c.set('requestId', 'request');
    c.set('edgeClientKey', 'client');
    await next();
  });
  parent.route('/', routes);
  return { api: parent, createPairing };
}
const token = { Authorization: `Bearer vl_agent_${'a'.repeat(43)}` };
const key = { 'Idempotency-Key': 'k'.repeat(16) };
const jsonType = { 'Content-Type': 'application/json' };
async function errorOf(response: Response) {
  return {
    status: response.status,
    code: ((await response.json()) as { error: { code: string } }).error.code,
  };
}

describe('discovery documents', () => {
  it('writes llms.txt in the llmstxt.org shape and hides the CLI when it is disabled', () => {
    const enabled = llmsTxt(origin, '0.5.0');
    expect(enabled.startsWith('# VibeLog\n\n> ')).toBe(true);
    expect(enabled).toContain('## Docs');
    expect(enabled).toContain(`(${origin}/agent-setup/prompt.md)`);
    expect(enabled).toContain('npx --yes @vibelog/cli@0.5.0');
    expect(enabled).toContain(`(${origin}/openapi.json)`);
    for (const [, url] of enabled.matchAll(/\]\((https?:\/\/[^)]+)\)/gu))
      expect(
        url.startsWith(origin) ||
          url.startsWith('https://github.com/') ||
          url.startsWith('https://www.npmjs.com/'),
      ).toBe(true);
    const disabled = llmsTxt(origin);
    expect(disabled).not.toContain('prompt.md');
    expect(disabled).not.toContain('@vibelog/cli');
    expect(disabled).not.toContain('agent-skills');
  });

  it('lists the agent API in an RFC 9727 linkset', () => {
    const catalog = apiCatalog(origin, '0.5.0');
    expect(catalog.linkset[0]).toEqual({
      anchor: `${origin}/.well-known/api-catalog`,
      item: [{ href: `${origin}/api/agent/v1` }],
    });
    expect(catalog.linkset[1]).toMatchObject({
      anchor: `${origin}/api/agent/v1`,
      'service-desc': [{ href: `${origin}/openapi.json` }],
      status: [{ href: `${origin}/health` }],
    });
    expect(JSON.stringify(apiCatalog(origin))).not.toContain('prompt.md');
  });

  it('publishes the agent instructions as a skill whose digest covers the served bytes', () => {
    const skill = agentSkill(origin, '0.5.0');
    const index = agentSkillsIndex(origin, '0.5.0');
    expect(index.$schema).toBe(AGENT_SKILLS_SCHEMA);
    expect(index.skills).toEqual([
      {
        name: skill.name,
        type: 'skill-md',
        description: skill.description,
        url: '/.well-known/agent-skills/vibelog/SKILL.md',
        digest: `sha256:${createHash('sha256').update(skill.markdown, 'utf8').digest('hex')}`,
      },
    ]);
    expect(skill.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    expect(skill.description.length).toBeLessThanOrEqual(1024);
    const [, frontmatter, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(skill.markdown) ?? [];
    expect(frontmatter).toBe(`name: vibelog\ndescription: ${JSON.stringify(skill.description)}`);
    expect(body).toContain('npx --yes @vibelog/cli@0.5.0');
  });
});

describe('generated OpenAPI document', () => {
  interface Operation {
    security?: unknown[];
    parameters?: { name: string; in: string }[];
  }
  async function document() {
    const response = await app('0.5.0').request('/openapi.json', {
      headers: { Host: 'localhost:3000' },
    });
    expect(response.status).toBe(200);
    return (await response.json()) as {
      openapi: string;
      servers: { url: string }[];
      components: { securitySchemes: Record<string, unknown> };
      paths: Record<string, Record<string, Operation>>;
    };
  }

  it('describes every agent route and only the pairing routes are anonymous', async () => {
    const spec = await document();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.servers).toEqual([{ url: 'http://localhost:3000/api/agent/v1' }]);
    expect(spec.components.securitySchemes.agentToken).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    const documented = Object.entries(spec.paths).flatMap(([path, operations]) =>
      Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`),
    );
    const registered = agentRoutes(database, { dispatch: () => Promise.resolve(0) }, origin, {
      betterAuthSecret: baseConfig.betterAuthSecret,
    })
      .routes.filter(
        ({ method, path }) => ['GET', 'POST', 'DELETE'].includes(method) && path !== '/*',
      )
      .map(({ method, path }) => `${method} ${path.replaceAll(/:([^/]+)/gu, '{$1}')}`);
    expect(new Set(documented)).toEqual(new Set(registered));
    for (const [path, operations] of Object.entries(spec.paths))
      for (const operation of Object.values(operations))
        expect(operation.security).toEqual(
          path.startsWith('/pairings') ? [] : [{ agentToken: [] }],
        );
    for (const action of ['connect', 'sync', 'identity', 'selection', 'design', 'publish'])
      expect(spec.paths[`/${action}`].post.parameters).toContainEqual(
        expect.objectContaining({ name: 'idempotency-key', in: 'header' }),
      );
  });

  it('prints regex patterns without JavaScript flags', async () => {
    const patterns = [
      ...JSON.stringify(await document()).matchAll(/"pattern":"((?:[^"\\]|\\.)*)"/gu),
    ].map(([, pattern]) => pattern);
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) expect(pattern).toMatch(/\$$/u);
  });
});

describe('agent API errors keep their codes', () => {
  it('reports pairing input errors as invalid_pairing and keeps empty bodies draft-only', async () => {
    const { api, createPairing } = agentApi();
    const post = (body: string, path = '/pairings') =>
      api.request(path, { method: 'POST', headers: jsonType, body });
    expect(await errorOf(await post('{'))).toEqual({ status: 400, code: 'invalid_pairing' });
    expect(await errorOf(await post('{"canPublish":true,"extra":1}'))).toEqual({
      status: 400,
      code: 'invalid_pairing',
    });
    expect((await post('')).status).toBe(201);
    expect(createPairing).toHaveBeenLastCalledWith(false);
    expect((await post('{"canPublish":true}')).status).toBe(201);
    expect(createPairing).toHaveBeenLastCalledWith(true);
    expect(await errorOf(await post('{}', '/pairings/token'))).toEqual({
      status: 400,
      code: 'invalid_pairing',
    });
    expect(await errorOf(await post('nope', '/pairings/token'))).toEqual({
      status: 400,
      code: 'invalid_pairing',
    });
  });

  it('reads pairing and validation bodies as JSON whatever the Content-Type says', async () => {
    const { api, createPairing } = agentApi();
    const post = (path: string, body: string, headers: Record<string, string>) =>
      api.request(path, { method: 'POST', headers: { ...token, ...headers }, body });
    const plain = { 'Content-Type': 'text/plain' };
    expect((await post('/pairings', '{"canPublish":true}', plain)).status).toBe(201);
    expect(createPairing).toHaveBeenLastCalledWith(true);
    expect((await post('/pairings', '{}', {})).status).toBe(201);
    expect(createPairing).toHaveBeenLastCalledWith(false);
    for (const type of [
      'application/json ;charset=utf-8',
      'application/json-patch',
      'APPLICATION/JSON',
    ])
      expect(
        (await post('/pairings', '{"canPublish":true}', { 'Content-Type': type })).status,
        type,
      ).toBe(201);
    expect(await errorOf(await post('/pairings', 'garbage', plain))).toEqual({
      status: 400,
      code: 'invalid_pairing',
    });
    expect(await errorOf(await post('/pairings/token', '{}', plain))).toEqual({
      status: 400,
      code: 'invalid_pairing',
    });
    const invalid = await post('/design/validate', '{"design":{}}', plain);
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ valid: false });
    expect(await errorOf(await post('/design/validate', 'garbage', {}))).toEqual({
      status: 400,
      code: 'invalid_input',
    });
  });

  it('rejects bad offsets and operation ids with their existing errors', async () => {
    const { api } = agentApi();
    for (const offset of ['-1', 'a', '1.5'])
      expect(
        await errorOf(await api.request(`/posts?offset=${offset}`, { headers: token })),
      ).toEqual({
        status: 400,
        code: 'invalid_offset',
      });
    expect(await errorOf(await api.request('/operations/not-a-uuid', { headers: token }))).toEqual({
      status: 404,
      code: 'operation_not_found',
    });
    expect(await errorOf(await api.request('/missing', { headers: token }))).toEqual({
      status: 404,
      code: 'not_found',
    });
  });

  it('checks mutations in the same order: permission, content type, key, then body', async () => {
    const { api } = agentApi(false);
    const post = (path: string, headers: Record<string, string>, body = '{}') =>
      api.request(path, { method: 'POST', headers: { ...token, ...headers }, body });
    expect(await errorOf(await post('/publish', {}))).toEqual({
      status: 403,
      code: 'publish_permission_required',
    });
    expect(await errorOf(await post('/sync', {}))).toEqual({
      status: 415,
      code: 'invalid_content_type',
    });
    expect(await errorOf(await post('/sync', { ...jsonType, 'Idempotency-Key': 'short' }))).toEqual(
      {
        status: 400,
        code: 'invalid_request_key',
      },
    );
    for (const body of ['{', '{}', '{"stateVersion":"x"}'])
      expect(await errorOf(await post('/sync', { ...jsonType, ...key }, body))).toEqual({
        status: 400,
        code: 'invalid_input',
      });
    expect(await errorOf(await post('/design/validate', jsonType, '{'))).toEqual({
      status: 400,
      code: 'invalid_input',
    });
    const invalid = await post('/design/validate', jsonType, '{"design":{}}');
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ valid: false });
    expect(await errorOf(await api.request('/session'))).toEqual({
      status: 401,
      code: 'agent_unauthorized',
    });
  });
});

describe('discovery routes', () => {
  const get = (path: string, version: string | null = '0.5.0', method = 'GET') =>
    app(version ?? undefined).request(path, { method, headers: { Host: 'localhost:3000' } });

  it('serves each document with its media type and a public cache', async () => {
    const expected = {
      '/llms.txt': 'text/plain; charset=utf-8',
      '/.well-known/api-catalog':
        'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
      '/openapi.json': 'application/json; charset=utf-8',
      '/.well-known/agent-skills/index.json': 'application/json',
      '/.well-known/agent-skills/vibelog/SKILL.md': 'text/markdown; charset=utf-8',
    };
    for (const [path, type] of Object.entries(expected)) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type'), path).toBe(type);
      expect(response.headers.get('cache-control'), path).toBe('public, max-age=3600');
    }
  });

  it('advertises the OpenAPI document with the media type it is served as', async () => {
    const catalog = (await (await get('/.well-known/api-catalog')).json()) as {
      linkset: { 'service-desc'?: { href: string; type: string }[] }[];
    };
    const [description] = catalog.linkset.flatMap((entry) => entry['service-desc'] ?? []);
    const served = await get(new URL(description.href).pathname);
    expect(served.headers.get('content-type')?.split(';')[0]).toBe(description.type);
  });

  it('answers HEAD on the API catalog with its Link header', async () => {
    const response = await get('/.well-known/api-catalog', '0.5.0', 'HEAD');
    expect(response.status).toBe(200);
    expect(response.headers.get('link')).toBe('</.well-known/api-catalog>; rel="api-catalog"');
  });

  it('serves the exact skill bytes the index digest names', async () => {
    const index = (await (await get('/.well-known/agent-skills/index.json')).json()) as {
      skills: { url: string; digest: string }[];
    };
    const skill = await (await get(index.skills[0].url)).text();
    expect(`sha256:${createHash('sha256').update(skill, 'utf8').digest('hex')}`).toBe(
      index.skills[0].digest,
    );
  });

  it('keeps agent skills off until a CLI version is configured', async () => {
    for (const path of [
      '/.well-known/agent-skills/index.json',
      '/.well-known/agent-skills/vibelog/SKILL.md',
    ])
      expect((await get(path, null)).status).toBe(404);
    expect((await get('/.well-known/agent-skills/other/SKILL.md')).status).toBe(404);
    expect((await get('/llms.txt', null)).status).toBe(200);
  });
});
