import { Hono } from 'hono';
import { describe, it, expect } from 'vitest';
import app from '../src/index';

describe('VibeLog App API', () => {
  it('GET /health should return ok status', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ status: 'ok', service: 'vibelog-saas' });
  });

  it('POST /api/projects should validate required fields', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    // Should fail without required fields
    expect(res.status).toBe(500);
  });

  it('POST /api/projects/:projectId/build should validate projectId', async () => {
    const res = await app.request('/api/projects/test-project/build', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ siteUrl: 'https://test.com' }),
    });

    // Should fail for non-existent project
    expect(res.status).toBe(500);
  });

  it('POST /api/projects/:projectId/style should validate projectId', async () => {
    const res = await app.request('/api/projects/test-project/style', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'dark theme',
        aiProvider: { type: 'openai', model: 'gpt-4o-mini' },
      }),
    });

    // Should fail for non-existent project
    expect(res.status).toBe(500);
  });

  it('GET /api/projects/:projectId/preview should return 404 for non-built project', async () => {
    const res = await app.request('/api/projects/non-existent-project/preview');
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.status).toBe('not-built');
    expect(data.projectId).toBe('non-existent-project');
  });
});
