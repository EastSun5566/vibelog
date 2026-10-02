import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_DESIGN_V2, designContractV2 } from '@vibelog/core';
import { requestHash, validateAgentDesign } from '../src/agent/contracts.js';
import { agentInstructions, onboardingPrompt } from '../src/agent/views.js';
import { loadAppConfig } from '../src/config.js';
import { landingPage } from '../src/views.js';

describe('agent design contract', () => {
  it('exposes an example accepted by the real validator without altering it', () => {
    const before = JSON.stringify(DEFAULT_DESIGN_V2);
    expect(validateAgentDesign(designContractV2().example).valid).toBe(true);
    expect(JSON.stringify(DEFAULT_DESIGN_V2)).toBe(before);
    expect(designContractV2().schema).toHaveProperty('properties.theme');
  });
  it('returns field diagnostics rather than the original arguments', () => {
    const result = validateAgentDesign({ ...DEFAULT_DESIGN_V2, version: 'private-invalid-value' });
    expect(result.valid).toBe(false); expect(JSON.stringify(result)).not.toContain('private-invalid-value');
    if (!result.valid) expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'version' })]));
  });
  it('fingerprints object fields independent of order but preserves array order and action', () => {
    expect(requestHash('design', { a: 1, b: 2 })).toBe(requestHash('design', { b: 2, a: 1 }));
    expect(requestHash('design', [1, 2])).not.toBe(requestHash('design', [2, 1]));
    expect(requestHash('design', {})).not.toBe(requestHash('sync', {}));
  });
  it('pins the scoped CLI and keeps publishing human-controlled', () => {
    expect(onboardingPrompt('https://vibelog.org', '0.1.0')).toContain('@vibelog/cli@0.1.0');
    expect(agentInstructions('https://vibelog.org', '0.1.0')).toContain('Do not print');
    expect(agentInstructions('https://vibelog.org', '0.1.0')).toContain('Never attempt publish');
  });
  it('keeps the onboarding entry disabled unless an explicit stable CLI version is configured', async () => {
    const env = {
      DATABASE_URL: 'postgresql://unused', BETTER_AUTH_SECRET: 'local-test-secret-at-least-32-characters',
      OBJECT_STORE_ENDPOINT: 'https://unused.example.com', OBJECT_STORE_BUCKET: 'unused',
      OBJECT_STORE_ACCESS_KEY_ID: 'unused', OBJECT_STORE_SECRET_ACCESS_KEY: 'unused',
      RESEND_API_KEY: 'unused', EMAIL_FROM: 'login@example.com',
    };
    expect(loadAppConfig(env).agentCliVersion).toBeUndefined();
    const app = new Hono().get('/', (c) => c.html(landingPage()))
      .get('/enabled', (c) => c.html(landingPage(undefined, onboardingPrompt('https://vibelog.org', '0.1.0'))));
    expect(await (await app.request('/')).text()).not.toContain('data-copy-agent-prompt');
    expect(loadAppConfig({ ...env, VIBELOG_AGENT_CLI_VERSION: '0.1.0' }).agentCliVersion).toBe('0.1.0');
    expect(await (await app.request('/enabled')).text()).toContain('@vibelog/cli@0.1.0');
    expect(() => loadAppConfig({ ...env, VIBELOG_AGENT_CLI_VERSION: 'latest' })).toThrow('pinned stable version');
  });
});
