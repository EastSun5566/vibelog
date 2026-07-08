import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import app from '../src/index';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('Project Management API', () => {
  const testProjectId = 'test-management-project';
  const projectRoot = resolve(process.cwd(), 'projects', testProjectId);

  beforeAll(async () => {
    // Create a test project directory
    await mkdir(projectRoot, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup
    try {
      await rm(projectRoot, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('GET /api/projects', () => {
    it('should return list of projects', async () => {
      const res = await app.request('/api/projects');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('projects');
      expect(Array.isArray(data.projects)).toBe(true);
    });

    it('should include test project in list', async () => {
      const res = await app.request('/api/projects');
      const data = await res.json();
      const testProject = data.projects.find((p: { id: string }) => p.id === testProjectId);
      expect(testProject).toBeDefined();
      expect(testProject.name).toBe(testProjectId);
      expect(testProject.hasVibelog).toBe(false);
      expect(testProject.hasBuilt).toBe(false);
    });
  });

  describe('GET /api/projects/:id', () => {
    it('should return project details', async () => {
      const res = await app.request(`/api/projects/${testProjectId}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe(testProjectId);
      expect(data.name).toBe(testProjectId);
      expect(data).toHaveProperty('paths');
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('stats');
    });

    it('should return 404 for non-existent project', async () => {
      const res = await app.request('/api/projects/non-existent-project');
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Project not found');
    });

    it('should show correct status flags', async () => {
      const res = await app.request(`/api/projects/${testProjectId}`);
      const data = await res.json();
      expect(data.status.hasVibelog).toBe(false);
      expect(data.status.hasBuilt).toBe(false);
      expect(data.status.canPreview).toBe(false);
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('should return 404 for non-existent project', async () => {
      const res = await app.request('/api/projects/non-existent-project', {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Project not found');
    });

    it('should delete existing project', async () => {
      // Create a temporary project to delete
      const tempProjectId = 'temp-delete-test';
      const tempProjectRoot = resolve(process.cwd(), 'projects', tempProjectId);
      await mkdir(tempProjectRoot, { recursive: true });

      // Delete it
      const res = await app.request(`/api/projects/${tempProjectId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('deleted');
      expect(data.projectId).toBe(tempProjectId);

      // Verify it's deleted by trying to get it
      const getRes = await app.request(`/api/projects/${tempProjectId}`);
      expect(getRes.status).toBe(404);
    });
  });
});
