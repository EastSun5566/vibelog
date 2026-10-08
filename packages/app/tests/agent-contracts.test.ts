import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_DESIGN_V2, designContractV2 } from '@vibelog/core';
import { agentNextActions, requestHash, validateAgentDesign } from '../src/agent/contracts.js';
import { agentInstructions, authorizationPage, grantsPage, onboardingPrompt } from '../src/agent/views.js';
import type { AppSession } from '../src/auth.js';
import { loadAppConfig } from '../src/config.js';
import { landingPage, loginPage } from '../src/views.js';

const session: AppSession = { id: 'session', user: { id: 'writer', email: 'writer@example.com', name: 'Writer' }, csrfToken: 'csrf-test', expiresAt: '2099-01-01' };
async function htmlOf(content: ReturnType<typeof loginPage>) { return (await new Hono().get('/', (c) => c.html(content)).request('/')).text(); }

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
  it('keeps the serialized contract and agent validator compatible with larger article layouts', () => {
    const design = structuredClone(DEFAULT_DESIGN_V2);
    design.theme.colors.accent = design.theme.colors.accent.toUpperCase();
    design.pages.article.modules = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [
      `metadata-${String(index)}`, { type: 'metadata' as const, variant: 'compact' as const },
    ]));
    design.pages.article.regions = { beforeBody: Object.keys(design.pages.article.modules), aside: [], afterBody: [] };
    expect(validateAgentDesign(design).valid).toBe(true);
    const contract = JSON.parse(JSON.stringify(designContractV2())) as ReturnType<typeof designContractV2>;
    expect(contract.schema).toEqual(designContractV2().schema);
    expect(contract.schema).toHaveProperty('$schema', 'http://json-schema.org/draft-07/schema#');
    expect(contract.schema).not.toHaveProperty('$defs');
  });
  it('fingerprints object fields independent of order but preserves array order and action', () => {
    expect(requestHash('design', { a: 1, b: 2 })).toBe(requestHash('design', { b: 2, a: 1 }));
    expect(requestHash('design', [1, 2])).not.toBe(requestHash('design', [2, 1]));
    expect(requestHash('design', {})).not.toBe(requestHash('sync', {}));
  });
  it('derives bounded next actions without interpreting failure messages or changing the blog', () => {
    const empty = { state: 'failed' as const, sourceArtifactId: null, draftArtifactId: null };
    const ready = { ...empty, sourceArtifactId: 'private-source', draftArtifactId: 'private-draft' };
    expect(agentNextActions(null, null)).toEqual([{ action: 'connect' }]);
    expect(agentNextActions(empty, 'operation')).toEqual([{ action: 'wait', operationId: 'operation' }]);
    expect(agentNextActions(empty, null)).toEqual([{ action: 'connect', reason: 'initial_sync_recovery' }]);
    for (const partial of [{ ...ready, sourceArtifactId: null }, { ...ready, draftArtifactId: null }]) {
      expect(agentNextActions(partial, null)).toEqual([{ action: 'open_editor', reason: 'draft_recovery_required' }]);
    }
    expect(agentNextActions(ready, null)).toEqual(['design', 'identity', 'selection', 'sync', 'open_editor'].map((action) => ({ action })));
    expect(agentNextActions({ ...ready, state: 'deleting' }, 'operation')).toEqual([{ action: 'open_editor', reason: 'deletion_in_progress' }]);
    expect(ready).toEqual({ state: 'failed', sourceArtifactId: 'private-source', draftArtifactId: 'private-draft' });
    expect(JSON.stringify(agentNextActions(ready, null))).not.toContain('private-');
  });
  it('pins the scoped CLI and keeps publishing human-controlled', () => {
    expect(onboardingPrompt('https://vibelog.org', '0.1.0')).toContain('@vibelog/cli@0.1.0');
    expect(agentInstructions('https://vibelog.org', '0.1.0')).toContain('Do not print');
    expect(agentInstructions('https://vibelog.org', '0.1.0')).toContain('Never attempt publish');
    const instructions = agentInstructions('https://vibelog.org', '0.1.0');
    expect(instructions).toContain('Run `status` first');
    expect(instructions).toContain('Read `context` before');
    expect(instructions).toContain('network or secure-storage error');
    expect(instructions).toContain('reuse them even when a later operation failed');
    expect(instructions).toContain('Run `sync` only when the human requests');
    expect(instructions).toContain('without asking for an extra');
    expect(instructions).toContain('not shell commands');
    expect(instructions).toContain('If an older server omits');
    expect(instructions).toContain('CLI 0.2.0 and later');
    expect(instructions).toContain('confirm the draft is ready with no active operation');
    expect(onboardingPrompt('https://vibelog.org', '0.1.0')).toContain('only if I have no blog');
  });
  it('explains the authorization handoff without changing normal email login', async () => {
    const input = { github: false, google: false, returnTo: '/agent/authorize?code=AABBCCDDEE' };
    expect(await htmlOf(loginPage(input))).toContain('Sign in first, then approve');
    const sent = await htmlOf(loginPage({ ...input, sent: true }));
    expect(sent).toContain('Open the link to sign in, then approve'); expect(sent).not.toContain('name="email"');
    expect(sent).toContain('returnTo=%2Fagent%2Fauthorize%3Fcode%3DAABBCCDDEE');
    expect(await htmlOf(loginPage({ github: false, google: false }))).toContain('We’ll email you a one-time sign-in link.');
    expect(await htmlOf(loginPage({ ...input, returnTo: 'https://example.com' }))).not.toContain('Sign in first, then approve');
  });
  it.each([
    ['pending', 'Authorize your agent'], ['approved', 'Draft access approved'], ['consumed', 'Agent connected'],
    ['denied', 'Access denied'], ['expired', 'Request expired'],
  ] as const)('renders real %s authorization state', async (status, title) => {
    const html = await htmlOf(authorizationPage(session, { userCode: 'AABBCCDDEE', status }));
    expect(html).toContain(`<h1>${title}</h1>`); expect(html).toContain('writer@example.com');
    if (status === 'pending') {
      expect(html).toContain('Use a different account'); expect(html).toContain('action="/auth/logout"');
      expect(html).toContain('value="/agent/authorize?code=AABBCCDDEE"'); expect(html).toContain('value="csrf-test"');
    } else expect(html).not.toContain('action="/agent/authorize"');
  });
  it('does not claim unavailable requests were approved and shares the prompt with signed-in users', async () => {
    const unavailable = await htmlOf(authorizationPage(session, null));
    expect(unavailable).toContain('Request unavailable'); expect(unavailable).not.toContain('Draft access approved');
    const prompt = onboardingPrompt('https://vibelog.org', '0.1.0');
    const grants = await htmlOf(grantsPage(session, [], prompt));
    expect(grants).toContain('data-copy-agent-prompt'); expect(grants).toContain('/assets/client.js'); expect(grants).toContain('@vibelog/cli@0.1.0');
    expect(await htmlOf(grantsPage(session, []))).not.toContain('data-copy-agent-prompt');
  });
  it('authorizes the onboarding client with the analytics CSP nonce', async () => {
    const app = new Hono().get('/', (c) => c.html(landingPage(
      { measurementId: 'G-TEST123', nonce: 'test-csp-nonce' },
      onboardingPrompt('https://vibelog.org', '0.1.0'),
    )));
    const html = await (await app.request('/')).text();
    expect(html).toContain('<script type="module" src="/assets/client.js" nonce="test-csp-nonce">');
    expect(html).toContain('nonce="test-csp-nonce" data-analytics-loader');
  });
  it('makes the prompt a direct primary entry without removing manual login or no-JS access', async () => {
    const html = await htmlOf(landingPage(undefined, onboardingPrompt('https://vibelog.org', '0.1.0')));
    expect(html).toContain('Keep writing in HackMD.'); expect(html).toContain('Publish a real blog.');
    expect(html).toContain('Copy agent prompt'); expect(html).toContain('Use the editor');
    expect(html).toContain('href="/auth/login"'); expect(html).toContain('readonly'); expect(html).toContain('@vibelog/cli@0.1.0');
    expect(html).not.toContain('<details'); expect(html).not.toContain('Start publishing');
    expect((html.match(/data-copy-agent-prompt/gu) ?? [])).toHaveLength(1);
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
