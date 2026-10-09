import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { checkNpmRelease, verifyNpmRelease, npmJson } from '../../../.github/scripts/npm-release.mjs';
import { waitForNpmRelease } from '../../../.github/scripts/wait-npm-release.mjs';

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

describe('shared npm publishing boundary', () => {
  it.each([['core', 'beta'], ['cli', 'latest']])('accepts only the matching %s tag and publishing configuration', (slug, distTag) => {
    const pkg = { name: `@vibelog/${slug}`, version: '1.2.3', publishConfig: { access: 'public', tag: distTag, registry: 'https://registry.npmjs.org' } };
    expect(checkNpmRelease(slug, `${slug}-v${pkg.version}`, pkg)).toEqual({ name: pkg.name, version: pkg.version, distTag });
    for (const tag of [`v${pkg.version}`, 'core-v99.0.0', `${slug}-v${pkg.version}-beta.1`, `${slug}-v01.2.3`, '']) {
      expect(() => checkNpmRelease(slug, tag, pkg)).toThrow();
    }
    expect(() => checkNpmRelease(slug, `${slug}-v${pkg.version}`, { ...pkg, private: true })).toThrow();
    expect(() => checkNpmRelease(slug, `${slug}-v${pkg.version}`, { ...pkg, name: '@vibelog/app' })).toThrow();
    expect(() => checkNpmRelease(slug, `${slug}-v${pkg.version}`, { ...pkg, publishConfig: { ...pkg.publishConfig, tag: 'next' } })).toThrow();
    expect(() => checkNpmRelease('app', 'app-v1.2.3', pkg)).toThrow();
    expect(() => checkNpmRelease(slug, `${slug === 'core' ? 'cli' : 'core'}-v1.2.3`, pkg)).toThrow();
  });

  it('uses the same OIDC flow while preserving trusted publisher workflow names', () => {
    const action = readFileSync(new URL('../actions/npm-release/action.yml', workflows), 'utf8');
    for (const slug of ['core', 'cli']) {
      const workflow = readFileSync(new URL(`${slug}-release.yml`, workflows), 'utf8');
      expect(workflow).toContain(`tags: ["${slug}-v*.*.*"]`);
      expect(workflow).toContain('environment: npm');
      expect(workflow).toContain('id-token: write');
      expect(workflow).toContain('uses: ./.github/actions/npm-release');
      expect(workflow).toContain(`package: ${slug}`);
      expect(workflow).not.toMatch(/secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN|packages: write|contents: write|workflow_dispatch|pull_request|pulumi/u);
    }
    expect(action).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main');
    expect(action).toContain('-f head_sha="$GITHUB_SHA"');
    expect(action).toContain('test "$passed" = true');
    expect(action).toContain('--tag "$RELEASE_DIST_TAG" --access public --provenance --ignore-scripts');
    expect(action).toContain('node .github/scripts/wait-npm-release.mjs');
    expect(action).toContain('cmp "$RELEASE_TARBALL" "$downloaded"');
    expect(action).not.toMatch(/secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN|pulumi/u);
    expect(action.match(/npm publish/g)).toHaveLength(2); // One dry-run and one publication; never retry publish.
  });
});

describe('published tarball verification', () => {
  const archive = Buffer.from('tested tarball');
  const dist = { integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`, attestations: { provenance: {} } };
  it.each([['core', 'beta'], ['cli', 'latest']])('verifies %s and preserves all other dist-tags', (slug, distTag) => {
    const release = { name: `@vibelog/${slug}`, version: '1.2.3', distTag };
    const before = { latest: '1.0.0', beta: '1.1.0', legacy: '0.1.0' };
    const tags = { ...before, [distTag]: release.version };
    expect(() => { verifyNpmRelease(release, before, dist, tags, archive); }).not.toThrow();
    expect(() => { verifyNpmRelease(release, before, dist, { ...tags, [distTag]: '1.2.2' }, archive); }).toThrow();
    expect(() => { verifyNpmRelease(release, before, dist, { ...tags, legacy: '9.0.0' }, archive); }).toThrow();
    expect(() => { verifyNpmRelease(release, before, dist, tags, Buffer.from('different tarball')); }).toThrow();
    expect(() => { verifyNpmRelease(release, before, { integrity: dist.integrity }, tags, archive); }).toThrow();
  });
  it('accepts npm object and singleton-array metadata without silently picking multiple results', () => {
    expect(npmJson(dist)).toEqual(dist);
    expect(npmJson([dist])).toEqual(dist);
    expect(() => { npmJson([]); }).toThrow();
    expect(() => { npmJson([dist, dist]); }).toThrow();
  });
});

describe('published npm registry readiness', () => {
  const version = '1.2.3';
  const ready = { 'dist-tags': { beta: version }, versions: { [version]: { dist: { integrity: 'sha512-tested', attestations: { provenance: {} } } } } };
  const response = (data) => new Response(JSON.stringify(data));
  afterEach(() => { vi.unstubAllGlobals(); });

  it('accepts a release that is immediately available', async () => {
    const fetch = vi.fn().mockResolvedValue(response(ready));
    vi.stubGlobal('fetch', fetch);
    await waitForNpmRelease('@vibelog/core', version, 'beta');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('waits through temporary 404s and incomplete metadata without publishing again', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(response({ ...ready, 'dist-tags': { beta: '1.2.2' } }))
      .mockResolvedValueOnce(response({ ...ready, versions: { [version]: { dist: { integrity: 'sha512-tested' } } } }))
      .mockResolvedValueOnce(response(ready));
    vi.stubGlobal('fetch', fetch);
    await waitForNpmRelease('@vibelog/core', version, 'beta', { intervalMs: 1 });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenCalledWith('https://registry.npmjs.org/@vibelog%2fcore', expect.objectContaining({ headers: { 'cache-control': 'no-cache' } }));
  });

  it('waits for the CLI latest channel using the same readiness logic', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ ...ready, 'dist-tags': { latest: version } }));
    vi.stubGlobal('fetch', fetch);
    await waitForNpmRelease('@vibelog/cli', version, 'latest');
    expect(fetch).toHaveBeenCalledWith('https://registry.npmjs.org/@vibelog%2fcli', expect.anything());
  });

  it('stops when the release never becomes available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(response({ versions: {} }))));
    await expect(waitForNpmRelease('@vibelog/core', version, 'beta', { timeoutMs: 20, intervalMs: 1 })).rejects.toThrow('Timed out waiting');
  });

  it.each([401, 500])('does not hide HTTP %s errors', async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status }));
    vi.stubGlobal('fetch', fetch);
    await expect(waitForNpmRelease('@vibelog/core', version, 'beta')).rejects.toThrow(`HTTP ${String(status)}`);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not hide network errors', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Network unavailable'));
    vi.stubGlobal('fetch', fetch);
    await expect(waitForNpmRelease('@vibelog/core', version, 'beta')).rejects.toThrow('Network unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
