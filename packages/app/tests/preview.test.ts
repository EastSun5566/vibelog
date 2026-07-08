import { describe, it, expect, afterAll } from 'vitest';
import app from '../src/index';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('Preview Integration', () => {
  const testProjectId = 'preview-test';
  const projectRoot = resolve(process.cwd(), 'projects', testProjectId);
  const fixtureContentDir = fileURLToPath(new URL('../../../tests/fixtures/content', import.meta.url));

  afterAll(async () => {
    // Cleanup test project
    try {
      await rm(projectRoot, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should create project, build it, and serve preview', async () => {
    // Step 1: Create project
    const createRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName: testProjectId,
        contentSource: {
          type: 'fs',
          handle: fixtureContentDir,
        },
      }),
    });

    expect(createRes.status).toBe(200);
    const createData = await createRes.json();
    expect(createData.status).toBe('created');

    // Step 2: Build project
    const buildRes = await app.request(`/api/projects/${testProjectId}/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteUrl: 'https://example.com' }),
    });

    expect(buildRes.status).toBe(200);
    const buildData = await buildRes.json();
    expect(buildData.status).toBe('built');
    expect(buildData.previewUrl).toBeDefined();
    expect(buildData.previewUrl).toContain(`/preview/${testProjectId}/`);

    // Step 3: Get preview URL
    const previewRes = await app.request(`/api/projects/${testProjectId}/preview`);
    expect(previewRes.status).toBe(200);
    const previewData = await previewRes.json();
    expect(previewData.status).toBe('ready');
    expect(previewData.previewUrl).toBeDefined();

    // Step 4: Access preview (should serve index.html)
    const previewPageRes = await app.request(`/preview/${testProjectId}/`);
    expect(previewPageRes.status).toBe(200);
    const html = await previewPageRes.text();
    expect(html).toContain('<!DOCTYPE html>');
  }, 120000); // 120 second timeout for npm install + build
});
