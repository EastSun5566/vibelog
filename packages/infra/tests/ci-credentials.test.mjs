import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkCoreRelease } from '../../../.github/scripts/check-core-release.mjs';
import { waitForCoreRelease } from '../../../.github/scripts/wait-core-release.mjs';

const workflows = new URL('../../../.github/workflows/', import.meta.url);
describe('pull-request credential boundary', () => {
  it('never grants PR workflows production authentication or OIDC permissions', () => {
    const pullRequestWorkflows = readdirSync(workflows).filter((name) => name.endsWith('.yml'))
      .map((name) => readFileSync(new URL(name, workflows), 'utf8'))
      .filter((workflow) => /^ {2}pull_request(?:_target)?:/mu.test(workflow));
    expect(pullRequestWorkflows.length).toBeGreaterThan(0);
    for (const workflow of pullRequestWorkflows) {
      expect(workflow).not.toMatch(/id-token:\s*write/u);
      expect(workflow).not.toMatch(/pulumi\/(?:auth-actions|esc-action)@/u);
      expect(workflow).not.toMatch(/environment:\s*production/iu);
      expect(workflow).not.toContain('EastSun5566/vibelog/prod');
    }
    const ci = readFileSync(new URL('ci.yml', workflows), 'utf8');
    expect(ci).toContain('pnpm --filter @vibelog/infra test');
  });
});

describe('independent core publishing boundary', () => {
  const pkg = { name: '@vibelog/core', version: '1.2.3', publishConfig: { access: 'public', tag: 'beta', registry: 'https://registry.npmjs.org' } };
  it('accepts only the matching core tag and public beta configuration', () => {
    expect(() => { checkCoreRelease(`core-v${pkg.version}`, pkg); }).not.toThrow();
    for (const tag of [`v${pkg.version}`, `cli-v${pkg.version}`, 'core-v99.0.0', `core-v${pkg.version}-beta.1`, 'core-v01.2.3', '']) {
      expect(() => { checkCoreRelease(tag, pkg); }).toThrow();
    }
    expect(() => { checkCoreRelease(`core-v${pkg.version}`, { ...pkg, private: true }); }).toThrow();
    expect(() => { checkCoreRelease(`core-v${pkg.version}`, { ...pkg, name: '@vibelog/cli' }); }).toThrow();
    expect(() => { checkCoreRelease(`core-v${pkg.version}`, { ...pkg, publishConfig: { ...pkg.publishConfig, tag: 'latest' } }); }).toThrow();
  });
  it('gates publishing on exact-SHA CI and uses OIDC without npm token secrets', () => {
    const workflow = readFileSync(new URL('core-release.yml', workflows), 'utf8');
    expect(workflow).toContain('tags: ["core-v*.*.*"]');
    expect(workflow).toContain('environment: npm');
    expect(workflow).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main');
    expect(workflow).toContain('-f head_sha="$GITHUB_SHA"');
    expect(workflow).toContain('test "$passed" = true');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('--tag beta --access public --provenance --ignore-scripts');
    expect(workflow).toContain('node .github/scripts/wait-core-release.mjs');
    expect(workflow).toContain('cmp "$CORE_TARBALL" "$downloaded"');
    expect(workflow).not.toMatch(/secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN|packages: write|contents: write|workflow_dispatch|pull_request|pulumi/u);
  });
});

describe('published core registry readiness', () => {
  const version = '1.2.3';
  const ready = { 'dist-tags': { beta: version }, versions: { [version]: { dist: { integrity: 'sha512-tested', attestations: { provenance: {} } } } } };
  const response = (data) => new Response(JSON.stringify(data));
  afterEach(() => { vi.unstubAllGlobals(); });

  it('accepts a release that is immediately available', async () => {
    const fetch = vi.fn().mockResolvedValue(response(ready));
    vi.stubGlobal('fetch', fetch);
    await waitForCoreRelease(version);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('waits through temporary 404s and incomplete metadata without publishing again', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(response({ ...ready, 'dist-tags': { beta: '1.2.2' } }))
      .mockResolvedValueOnce(response({ ...ready, versions: { [version]: { dist: { integrity: 'sha512-tested' } } } }))
      .mockResolvedValueOnce(response(ready));
    vi.stubGlobal('fetch', fetch);
    await waitForCoreRelease(version, { intervalMs: 1 });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenCalledWith('https://registry.npmjs.org/@vibelog%2fcore', expect.objectContaining({ headers: { 'cache-control': 'no-cache' } }));
  });

  it('stops when the release never becomes available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(response({ versions: {} }))));
    await expect(waitForCoreRelease(version, { timeoutMs: 20, intervalMs: 1 })).rejects.toThrow('Timed out waiting');
  });

  it.each([401, 500])('does not hide HTTP %s errors', async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status }));
    vi.stubGlobal('fetch', fetch);
    await expect(waitForCoreRelease(version)).rejects.toThrow(`HTTP ${String(status)}`);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not hide network errors', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Network unavailable'));
    vi.stubGlobal('fetch', fetch);
    await expect(waitForCoreRelease(version)).rejects.toThrow('Network unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
