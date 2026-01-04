import Fastify from 'fastify';
import cors from '@fastify/cors';
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

const fastify = Fastify({
  logger: true,
});

await fastify.register(cors, {
  origin: true,
});

// Create a silent logger for library usage
const silentLogger = createLogger(true);

/**
 * Health check endpoint
 */
fastify.get('/health', async () => {
  return { status: 'ok', service: 'vibelog-saas' };
});

/**
 * Create a new project
 * 
 * Example:
 * POST /api/projects
 * {
 *   "contentSource": { "type": "fs", "handle": "./content" },
 *   "projectName": "my-blog"
 * }
 */
fastify.post<{
  Body: {
    contentSource: { type: string; handle: string };
    projectName: string;
  };
}>('/api/projects', async (request, reply) => {
  const { contentSource: sourceConfig, projectName } = request.body;

  try {
    // Create content source from API request
    const contentSource = createContentSource(
      sourceConfig.type as ContentSourceName,
      sourceConfig.handle,
    );

    // Create project directory (in production, this would be a temp directory or persistent storage)
    const projectRoot = resolve(process.cwd(), 'projects', projectName);

    const builder = createDevBuilder({
      root: projectRoot,
      contentSource,
      baseDir: '/',
    });

    await builder.prepare();
    await builder.fetchContent();

    return {
      projectId: projectName,
      status: 'created',
      vibelogDir: builder.vibelogDir,
    };
  } catch (error) {
    reply.code(500);
    return {
      error: 'Failed to create project',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

/**
 * Build a project
 * 
 * Example:
 * POST /api/projects/:projectId/build
 * {
 *   "siteUrl": "https://myblog.com"
 * }
 */
fastify.post<{
  Params: { projectId: string };
  Body: { siteUrl?: string };
}>('/api/projects/:projectId/build', async (request, reply) => {
  const { projectId } = request.params;
  const { siteUrl = 'https://example.com' } = request.body;

  try {
    const projectRoot = resolve(process.cwd(), 'projects', projectId);
    const vibelogDir = resolve(projectRoot, '.vibelog');
    const outDir = resolve(projectRoot, 'dist');

    await buildFromVibelog({
      vibelogDir,
      outDir,
      site: siteUrl,
    });

    return {
      projectId,
      status: 'built',
      outputDir: outDir,
    };
  } catch (error) {
    reply.code(500);
    return {
      error: 'Failed to build project',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

/**
 * Transform styles with AI
 * 
 * Example:
 * POST /api/projects/:projectId/style
 * {
 *   "prompt": "dark theme with neon purple accents",
 *   "aiProvider": { "type": "openai", "model": "gpt-4o-mini" }
 * }
 */
fastify.post<{
  Params: { projectId: string };
  Body: {
    prompt: string;
    aiProvider: { type: string; model: string };
  };
}>('/api/projects/:projectId/style', async (request, reply) => {
  const { projectId } = request.params;
  const { prompt, aiProvider: providerConfig } = request.body;

  try {
    const aiProvider = createAiProvider(
      providerConfig.type as AiProviderName,
      providerConfig.model,
    );

    const transformer = createStyleTransformer({ aiProvider });

    const projectRoot = resolve(process.cwd(), 'projects', projectId);
    const cssPath = resolve(projectRoot, '.vibelog', 'src', 'styles', 'global.css');

    // In production, read existing CSS, transform it, and write back
    // For now, just demonstrate the API
    const { readFile, writeFile } = await import('node:fs/promises');
    const originalCss = await readFile(cssPath, 'utf-8');

    const { transformedCss, description } = await transformer.transform({
      originalCss,
      stylePrompt: prompt,
    });

    await writeFile(cssPath, transformedCss);

    return {
      projectId,
      status: 'styled',
      description,
    };
  } catch (error) {
    reply.code(500);
    return {
      error: 'Failed to transform styles',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

/**
 * Start the server
 */
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000');
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 VibeLog SaaS running on http://localhost:${port}`);
    console.log(`📝 API Documentation:`);
    console.log(`   POST /api/projects - Create a new project`);
    console.log(`   POST /api/projects/:id/build - Build project`);
    console.log(`   POST /api/projects/:id/style - Transform styles with AI`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
