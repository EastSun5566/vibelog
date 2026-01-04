import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  createDevBuilder,
  buildFromVibelog,
  createContentSource,
  createAiProvider,
  createStyleTransformer,
  createLogger,
  ContentSourceName,
  AiProviderName,
  type ContentSource,
} from '@vibelog/core';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Main Hono application instance
 *
 * This app provides a REST API for VibeLog's blog generation functionality.
 * It exposes three main endpoints:
 * 1. POST /api/projects - Create a new blog project from content source
 * 2. POST /api/projects/:id/build - Build static site from .vibelog directory
 * 3. POST /api/projects/:id/style - Transform styles using AI
 */
const app = new Hono();

// Global middleware
app.use('*', logger());  // Request logging
app.use('*', cors());    // Enable CORS for all origins

// Static file serving for preview
// Serves built sites from projects/*/dist/ directories
app.get('/preview/:projectId/*', async (c) => {
  const projectId = c.req.param('projectId');
  const projectRoot = resolve(process.cwd(), 'projects', projectId);
  const distDir = resolve(projectRoot, 'dist');

  // Check if dist directory exists
  if (!existsSync(distDir)) {
    return c.json({ error: 'Project not built yet' }, 404);
  }

  // Get the path after /preview/:projectId/
  const path = c.req.path.replace(`/preview/${projectId}`, '') || '/';

  // Serve static files from dist directory
  const handler = serveStatic({
    root: `./projects/${projectId}/dist`,
    rewriteRequestPath: () => path,
  });

  return handler(c, async () => {});
});

// Create a silent logger for @vibelog/core library calls
// This prevents verbose logging from content fetching and building processes
const silentLogger = createLogger(true);

/**
 * Health check endpoint
 */
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'vibelog-saas' });
});

/**
 * Create a new blog project
 *
 * This endpoint:
 * 1. Creates a content source adapter (FS/Notion/HackMD)
 * 2. Initializes .vibelog directory with Astro template
 * 3. Installs dependencies
 * 4. Fetches content from source and writes to .vibelog/src/content
 *
 * Request Body:
 * {
 *   "contentSource": {
 *     "type": "fs" | "notion" | "hackmd",
 *     "handle": string  // Path/URL/credentials
 *   },
 *   "projectName": string
 * }
 *
 * Response:
 * {
 *   "projectId": string,
 *   "status": "created",
 *   "vibelogDir": string  // Path to .vibelog directory
 * }
 */
app.post('/api/projects', async (c) => {
  const { contentSource: sourceConfig, projectName } = await c.req.json<{
    contentSource: { type: string; handle: string };
    projectName: string;
  }>();

  try {
    // Factory function creates type-safe content source adapter
    const contentSource = createContentSource(
      sourceConfig.type as ContentSourceName,
      sourceConfig.handle,
    );

    // In production: use temp directory or cloud storage (e.g., /tmp or S3)
    // In development: local projects directory
    const projectRoot = resolve(process.cwd(), 'projects', projectName);

    const builder = createDevBuilder({
      root: projectRoot,
      contentSource,
      baseDir: '/',
    });

    await builder.prepare();
    await builder.fetchContent();

    return c.json({
      projectId: projectName,
      status: 'created',
      vibelogDir: builder.vibelogDir,
    });
  } catch (error) {
    return c.json({
      error: 'Failed to create project',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Build static site from .vibelog directory
 *
 * This endpoint:
 * 1. Locates the .vibelog directory from previous project creation
 * 2. Runs Astro build process (SSG)
 * 3. Generates static HTML/CSS/JS files
 * 4. Outputs to dist/ directory
 *
 * Request Body:
 * {
 *   "siteUrl": string  // Base URL for the site (optional, defaults to example.com)
 * }
 *
 * Response:
 * {
 *   "projectId": string,
 *   "status": "built",
 *   "outputDir": string  // Path to dist/ directory with static files
 * }
 */
app.post('/api/projects/:projectId/build', async (c) => {
  const projectId = c.req.param('projectId');
  const { siteUrl = 'https://example.com' } = await c.req.json<{ siteUrl?: string }>();

  try {
    const projectRoot = resolve(process.cwd(), 'projects', projectId);
    const vibelogDir = resolve(projectRoot, '.vibelog');
    const outDir = resolve(projectRoot, 'dist');

    await buildFromVibelog({
      vibelogDir,
      outDir,
      site: siteUrl,
    });

    // Get base URL for preview link
    const url = new URL(c.req.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    return c.json({
      projectId,
      status: 'built',
      outputDir: outDir,
      previewUrl: `${baseUrl}/preview/${projectId}/`,
    });
  } catch (error) {
    return c.json({
      error: 'Failed to build project',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Transform blog styles using AI
 *
 * This endpoint:
 * 1. Reads the current global.css from .vibelog
 * 2. Sends CSS + style prompt to AI model
 * 3. AI generates transformed CSS based on prompt
 * 4. Writes transformed CSS back to global.css
 *
 * Request Body:
 * {
 *   "prompt": string,  // Natural language style description
 *   "aiProvider": {
 *     "type": "openai" | "anthropic" | "google" | "ollama",
 *     "model": string  // e.g., "gpt-4o-mini", "claude-3-5-sonnet"
 *   }
 * }
 *
 * Response:
 * {
 *   "projectId": string,
 *   "status": "styled",
 *   "description": string  // AI's description of changes made
 * }
 */
app.post('/api/projects/:projectId/style', async (c) => {
  const projectId = c.req.param('projectId');
  const { prompt, aiProvider: providerConfig } = await c.req.json<{
    prompt: string;
    aiProvider: { type: string; model: string };
  }>();

  try {
    // Factory function creates type-safe AI provider
    const aiProvider = createAiProvider(
      providerConfig.type as AiProviderName,
      providerConfig.model,
    );

    const transformer = createStyleTransformer({ aiProvider });

    const projectRoot = resolve(process.cwd(), 'projects', projectId);
    const cssPath = resolve(projectRoot, '.vibelog', 'src', 'styles', 'global.css');

    // Read current CSS, transform via AI, write back
    const { readFile, writeFile } = await import('node:fs/promises');
    const originalCss = await readFile(cssPath, 'utf-8');

    const { transformedCss, description } = await transformer.transform({
      originalCss,
      stylePrompt: prompt,
    });

    await writeFile(cssPath, transformedCss);

    return c.json({
      projectId,
      status: 'styled',
      description,
    });
  } catch (error) {
    return c.json({
      error: 'Failed to transform styles',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Get preview URL for a project
 *
 * This endpoint returns the preview URL where the built static site can be viewed.
 * The site must be built first using POST /api/projects/:id/build.
 *
 * Response:
 * {
 *   "projectId": string,
 *   "previewUrl": string,  // Full URL to preview the site
 *   "status": "ready" | "not-built",
 *   "message": string
 * }
 */
app.get('/api/projects/:projectId/preview', (c) => {
  const projectId = c.req.param('projectId');
  const projectRoot = resolve(process.cwd(), 'projects', projectId);
  const distDir = resolve(projectRoot, 'dist');

  // Check if project has been built
  if (!existsSync(distDir)) {
    return c.json({
      projectId,
      status: 'not-built',
      message: 'Project not built yet. Please build the project first.',
    }, 404);
  }

  // Get base URL for preview link
  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  return c.json({
    projectId,
    previewUrl: `${baseUrl}/preview/${projectId}/`,
    status: 'ready',
  });
});

export default app;
