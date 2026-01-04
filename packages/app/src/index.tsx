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
  ContentSourceName,
  AiProviderName,
} from '@vibelog/core';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { ProjectList } from './components/ProjectList';
import { CreateProject } from './components/CreateProject';
import { ProjectDetail } from './components/ProjectDetail';
import { StyleTransform } from './components/StyleTransform';

/**
 * Main Hono application instance
 *
 * This app provides both a web UI and REST API for VibeLog's blog generation functionality.
 * 
 * UI Routes:
 * - GET / - Home page (redirects to projects)
 * - GET /projects - List all projects
 * - GET /projects/new - Create new project form
 * - GET /projects/:id - Project detail page
 * - GET /projects/:id/style - Style transformation form
 * 
 * API Routes:
 * - POST /api/projects - Create a new blog project from content source
 * - POST /api/projects/:id/build - Build static site from .vibelog directory
 * - POST /api/projects/:id/style - Transform styles using AI
 * - POST /api/projects/:id/deploy - Deploy to Cloudflare Pages
 */
const app = new Hono();

// Global middleware
app.use('*', logger());  // Request logging
app.use('*', cors());    // Enable CORS for all origins

// ============================================================================
// UI Routes (HTML Pages)
// ============================================================================

/**
 * Home page - redirects to projects list
 */
app.get('/', (c) => c.redirect('/projects'));

/**
 * Projects list page
 */
app.get('/projects', (c) => c.html(<ProjectList />));

/**
 * Create new project form
 */
app.get('/projects/new', (c) => c.html(<CreateProject />));

/**
 * Project detail page
 */
app.get('/projects/:id', (c) => {
  const projectId = c.req.param('id');
  return c.html(<ProjectDetail projectId={projectId} />);
});

/**
 * Style transformation form
 */
app.get('/projects/:id/style', (c) => {
  const projectId = c.req.param('id');
  return c.html(<StyleTransform projectId={projectId} />);
});

// ============================================================================
// API Routes (JSON)
// ============================================================================

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

  return handler(c, async () => {
    // Fallback handler - do nothing
  });
});

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
 * Accepts both JSON (API) and form-encoded data (from HTML form)
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
 * - JSON API: Returns JSON with project details
 * - HTML Form: Redirects to project detail page
 */
app.post('/api/projects', async (c) => {
  // Parse request body (supports both JSON and form data)
  const contentType = c.req.header('content-type') ?? '';
  
  try {
    let sourceConfig: { type: string; handle: string };
    let projectName: string;

    if (contentType.includes('application/json')) {
      // JSON API request
      const body = await c.req.json<{
        contentSource: { type: string; handle: string };
        projectName: string;
      }>();
      sourceConfig = body.contentSource;
      projectName = body.projectName;
    } else {
      // HTML form request
      const formData = await c.req.formData();
      projectName = String(formData.get('projectName'));
      sourceConfig = {
        type: String(formData.get('contentSource.type')),
        handle: String(formData.get('contentSource.handle')),
      };
    }

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

    // Return response based on request type
    if (contentType.includes('application/json')) {
      // JSON API response
      return c.json({
        projectId: projectName,
        status: 'created',
        vibelogDir: builder.vibelogDir,
      });
    } else {
      // HTML form response - redirect to project page
      return c.redirect(`/projects/${projectName}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Return error based on request type
    if (contentType.includes('application/json')) {
      return c.json({
        error: 'Failed to create project',
        message: errorMessage,
      }, 500);
    } else {
      // For HTML forms, redirect back with error (in a real app, use flash messages)
      return c.html(
        <div>
          <h1>Error Creating Project</h1>
          <p>{errorMessage}</p>
          <a href="/projects/new">Try Again</a>
        </div>,
        500,
      );
    }
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
 * Accepts both JSON (API) and form-encoded data (from HTML form)
 *
 * Request Body:
 * {
 *   "siteUrl": string  // Base URL for the site (optional, defaults to example.com)
 * }
 *
 * Response:
 * - JSON API: Returns JSON with build details
 * - HTML Form: Redirects to project detail page
 */
app.post('/api/projects/:projectId/build', async (c) => {
  const projectId = c.req.param('projectId');
  const contentType = c.req.header('content-type') ?? '';
  
  try {
    let siteUrl = 'https://example.com';

    if (contentType.includes('application/json')) {
      // JSON API request
      const body = await c.req.json<{ siteUrl?: string }>();
      siteUrl = body.siteUrl ?? siteUrl;
    } else {
      // HTML form request
      const formData = await c.req.formData();
      const formSiteUrl = formData.get('siteUrl');
      if (formSiteUrl && String(formSiteUrl).trim()) {
        siteUrl = String(formSiteUrl);
      }
    }

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

    // Return response based on request type
    if (contentType.includes('application/json')) {
      // JSON API response
      return c.json({
        projectId,
        status: 'built',
        outputDir: outDir,
        previewUrl: `${baseUrl}/preview/${projectId}/`,
      });
    } else {
      // HTML form response - redirect to project page
      return c.redirect(`/projects/${projectId}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Return error based on request type
    if (contentType.includes('application/json')) {
      return c.json({
        error: 'Failed to build project',
        message: errorMessage,
      }, 500);
    } else {
      // For HTML forms, show error page
      return c.html(
        <div>
          <h1>Error Building Project</h1>
          <p>{errorMessage}</p>
          <a href={`/projects/${projectId}`}>Back to Project</a>
        </div>,
        500,
      );
    }
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
 * Accepts both JSON (API) and form-encoded data (from HTML form)
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
 * - JSON API: Returns JSON with transformation details
 * - HTML Form: Redirects to project detail page
 */
app.post('/api/projects/:projectId/style', async (c) => {
  const projectId = c.req.param('projectId');
  const contentType = c.req.header('content-type') ?? '';
  
  try {
    let prompt: string;
    let providerConfig: { type: string; model: string };

    if (contentType.includes('application/json')) {
      // JSON API request
      const body = await c.req.json<{
        prompt: string;
        aiProvider: { type: string; model: string };
      }>();
      prompt = body.prompt;
      providerConfig = body.aiProvider;
    } else {
      // HTML form request
      const formData = await c.req.formData();
      prompt = String(formData.get('prompt'));
      providerConfig = {
        type: String(formData.get('aiProvider.type')),
        model: String(formData.get('aiProvider.model')),
      };
    }

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

    // Return response based on request type
    if (contentType.includes('application/json')) {
      // JSON API response
      return c.json({
        projectId,
        status: 'styled',
        description,
      });
    } else {
      // HTML form response - redirect to project page
      return c.redirect(`/projects/${projectId}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Return error based on request type
    if (contentType.includes('application/json')) {
      return c.json({
        error: 'Failed to transform styles',
        message: errorMessage,
      }, 500);
    } else {
      // For HTML forms, show error page
      return c.html(
        <div>
          <h1>Error Transforming Styles</h1>
          <p>{errorMessage}</p>
          <a href={`/projects/${projectId}/style`}>Try Again</a>
        </div>,
        500,
      );
    }
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

/**
 * Deploy project to Cloudflare Pages
 *
 * This endpoint deploys the built static site to Cloudflare Pages.
 * The project must be built first using POST /api/projects/:id/build.
 *
 * Request Body:
 * {
 *   "cloudflare": {
 *     "accountId": string,      // Cloudflare account ID
 *     "apiToken": string,       // Cloudflare API token with Pages write access
 *     "projectName": string,    // Cloudflare Pages project name
 *     "branch"?: string         // Git branch name (optional, defaults to "main")
 *   }
 * }
 *
 * Response:
 * {
 *   "projectId": string,
 *   "status": "deployed" | "failed",
 *   "platform": "cloudflare",
 *   "deploymentUrl": string,     // Live deployment URL
 *   "deploymentId": string,
 *   "environment": string,        // "production" or "preview"
 *   "error"?: string
 * }
 */
app.post('/api/projects/:projectId/deploy', async (c) => {
  const projectId = c.req.param('projectId');
  const { cloudflare } = await c.req.json<{
    cloudflare: {
      accountId: string;
      apiToken: string;
      projectName: string;
      branch?: string;
    };
  }>();

  try {
    const projectRoot = resolve(process.cwd(), 'projects', projectId);
    const distDir = resolve(projectRoot, 'dist');

    // Check if project has been built
    if (!existsSync(distDir)) {
      return c.json({
        error: 'Project not built',
        message: 'Please build the project first before deploying.',
      }, 400);
    }

    // Import deployment function dynamically to avoid loading it unnecessarily
    const { deployToCloudflarePages } = await import('./deploy/cloudflare.js');

    // Deploy to Cloudflare Pages
    const result = await deployToCloudflarePages(distDir, {
      accountId: cloudflare.accountId,
      apiToken: cloudflare.apiToken,
      projectName: cloudflare.projectName,
      branch: cloudflare.branch,
    });

    if (!result.success) {
      return c.json({
        projectId,
        status: 'failed',
        platform: 'cloudflare',
        error: result.error,
      }, 500);
    }

    return c.json({
      projectId,
      status: 'deployed',
      platform: 'cloudflare',
      deploymentUrl: result.url,
      deploymentId: result.deploymentId,
      environment: result.environment,
    });
  } catch (error) {
    return c.json({
      error: 'Failed to deploy project',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * List deployments for a project
 *
 * This endpoint returns all deployments for a Cloudflare Pages project.
 *
 * Query Parameters:
 * - accountId: Cloudflare account ID
 * - apiToken: Cloudflare API token
 * - projectName: Cloudflare Pages project name
 *
 * Response:
 * {
 *   "projectId": string,
 *   "platform": "cloudflare",
 *   "deployments": Array<{
 *     "id": string,
 *     "url": string,
 *     "environment": string,
 *     "createdOn": string,
 *     "productionBranch": boolean
 *   }>
 * }
 */
app.get('/api/projects/:projectId/deployments', async (c) => {
  const projectId = c.req.param('projectId');
  const accountId = c.req.query('accountId');
  const apiToken = c.req.query('apiToken');
  const projectName = c.req.query('projectName');

  if (!accountId || !apiToken || !projectName) {
    return c.json({
      error: 'Missing required parameters',
      message: 'accountId, apiToken, and projectName are required',
    }, 400);
  }

  try {
    const { listCloudflareDeployments } = await import('./deploy/cloudflare.js');

    const deployments = await listCloudflareDeployments(
      accountId,
      apiToken,
      projectName,
    );

    return c.json({
      projectId,
      platform: 'cloudflare',
      deployments,
    });
  } catch (error) {
    return c.json({
      error: 'Failed to list deployments',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * List all projects
 *
 * Returns a list of all projects in the projects directory.
 *
 * Response:
 * {
 *   "projects": Array<{
 *     "id": string,
 *     "name": string,
 *     "hasVibelog": boolean,
 *     "hasBuilt": boolean,
 *     "createdAt": string,
 *     "size"?: number
 *   }>
 * }
 */
app.get('/api/projects', async (c) => {
  try {
    const projectsRoot = resolve(process.cwd(), 'projects');
    const { readdir, stat } = await import('node:fs/promises');

    // Check if projects directory exists
    if (!existsSync(projectsRoot)) {
      return c.json({ projects: [] });
    }

    const entries = await readdir(projectsRoot, { withFileTypes: true });
    const projects = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const projectPath = resolve(projectsRoot, entry.name);
        const vibelogDir = resolve(projectPath, '.vibelog');
        const distDir = resolve(projectPath, 'dist');

        const stats = await stat(projectPath);

        projects.push({
          id: entry.name,
          name: entry.name,
          hasVibelog: existsSync(vibelogDir),
          hasBuilt: existsSync(distDir),
          createdAt: stats.birthtime.toISOString(),
        });
      }
    }

    return c.json({ projects });
  } catch (error) {
    return c.json({
      error: 'Failed to list projects',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Get project details
 *
 * Returns detailed information about a specific project.
 *
 * Response:
 * {
 *   "id": string,
 *   "name": string,
 *   "paths": {
 *     "root": string,
 *     "vibelog": string,
 *     "dist": string
 *   },
 *   "status": {
 *     "hasVibelog": boolean,
 *     "hasBuilt": boolean,
 *     "canPreview": boolean
 *   },
 *   "stats": {
 *     "createdAt": string,
 *     "modifiedAt": string,
 *     "size": number
 *   }
 * }
 */
app.get('/api/projects/:projectId', async (c) => {
  const projectId = c.req.param('projectId');

  try {
    const projectRoot = resolve(process.cwd(), 'projects', projectId);

    if (!existsSync(projectRoot)) {
      return c.json({
        error: 'Project not found',
        message: `Project '${projectId}' does not exist`,
      }, 404);
    }

    const { stat } = await import('node:fs/promises');
    const vibelogDir = resolve(projectRoot, '.vibelog');
    const distDir = resolve(projectRoot, 'dist');

    const stats = await stat(projectRoot);
    const hasVibelog = existsSync(vibelogDir);
    const hasBuilt = existsSync(distDir);

    return c.json({
      id: projectId,
      name: projectId,
      paths: {
        root: projectRoot,
        vibelog: vibelogDir,
        dist: distDir,
      },
      status: {
        hasVibelog,
        hasBuilt,
        canPreview: hasBuilt,
      },
      stats: {
        createdAt: stats.birthtime.toISOString(),
        modifiedAt: stats.mtime.toISOString(),
        size: stats.size,
      },
    });
  } catch (error) {
    return c.json({
      error: 'Failed to get project details',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Delete a project
 *
 * Deletes a project and all its associated files.
 *
 * Response:
 * {
 *   "projectId": string,
 *   "status": "deleted",
 *   "message": string
 * }
 */
app.delete('/api/projects/:projectId', async (c) => {
  const projectId = c.req.param('projectId');

  try {
    const projectRoot = resolve(process.cwd(), 'projects', projectId);

    if (!existsSync(projectRoot)) {
      return c.json({
        error: 'Project not found',
        message: `Project '${projectId}' does not exist`,
      }, 404);
    }

    const { rm } = await import('node:fs/promises');

    // Delete project directory with retry logic
    await rm(projectRoot, {
      recursive: true,
      force: true,
      maxRetries: 3,
    });

    return c.json({
      projectId,
      status: 'deleted',
      message: `Project '${projectId}' has been deleted successfully`,
    });
  } catch (error) {
    return c.json({
      error: 'Failed to delete project',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

export default app;
