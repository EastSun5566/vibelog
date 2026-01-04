import { describe, it, expect } from 'vitest';
import app from '../src/index';

describe('Deployment API', () => {
  const testProjectId = 'deploy-test';

  it('POST /api/projects/:id/deploy should return 400 if project not built', async () => {
    const res = await app.request(`/api/projects/${testProjectId}/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cloudflare: {
          accountId: 'test-account',
          apiToken: 'test-token',
          projectName: 'test-project',
        },
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Project not built');
  });

  it('GET /api/projects/:id/deployments should return 400 without required params', async () => {
    const res = await app.request(`/api/projects/${testProjectId}/deployments`);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Missing required parameters');
  });

  it('GET /api/projects/:id/deployments should accept query parameters', async () => {
    const res = await app.request(
      `/api/projects/${testProjectId}/deployments?accountId=test&apiToken=test&projectName=test`,
    );

    // Will fail to fetch from Cloudflare API but should pass validation
    expect([200, 500]).toContain(res.status);
  });
});
