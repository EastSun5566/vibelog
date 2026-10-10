import { eq } from 'drizzle-orm';
import { blogs } from '../schema.js';
import { Hono, type Context } from 'hono';
import { createHmac } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { z } from 'zod';
import { analyzeDesignImpact, designContractV2 } from '@vibelog/core';
import type { AppVariables } from '../auth.js';
import type { AppConfig } from '../config.js';
import { blogIdentitySchema, blogLanguageSchema } from '../blog-sync.js';
import { AppDatabase, BlogAddressTakenError, BlogAlreadyExistsError, BlogConnectionConflictError } from '../database.js';
import { AppError, jsonError } from '../http.js';
import { operationMessage, operationProgress } from '../operation-status.js';
import type { OperationDispatcher } from '../ports/operation-queue.js';
import { AGENT_PERMISSION, agentNextActions, stateVersion, validateAgentDesign } from './contracts.js';
import { AgentRepository, operationResult } from './repository.js';

const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const connect = z.object({
  username: z.string().trim().toLowerCase().min(3).max(32).regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/u),
  hackmdUsername: z.string().trim().min(1).max(100).regex(/^[\p{L}\p{N}_.-]+$/u),
  language: blogLanguageSchema.default('en'),
  stateVersion: state.optional(),
}).strict();
const reserved = new Set(['preview', 'www', 'api', 'admin', 'assets']);
type Variables = AppVariables & { agentUserId: string; agentGrantId: string; agentExpiresAt: string; agentCanPublish: boolean };

export function agentRoutes(database: AppDatabase, dispatcher: OperationDispatcher, origin: string, config: Pick<AppConfig, 'edgeSharedSecret' | 'betterAuthSecret'>) {
  const app = new Hono<{ Variables: Variables }>();
  const repo = new AgentRepository(database);
  app.onError((error, c) => {
    if (error instanceof BlogConnectionConflictError) return jsonError(c, new AppError(error.code, error.message, 409));
    if (error instanceof BlogAddressTakenError) return jsonError(c, new AppError('blog_address_taken', 'That blog address is already taken.', 409));
    if (error instanceof AppError) return jsonError(c, error);
    // Database errors can contain SQL parameters; never log external design payloads.
    console.error('agent_request_failed', { requestId: c.get('requestId') });
    return c.json({ error: { code: 'internal_error', message: 'The request could not be completed.', requestId: c.get('requestId') } }, 500);
  });
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  app.use('*', async (c: Context<{ Variables: Variables }>, next) => {
    if (!c.req.path.endsWith('/pairings') && !c.req.path.endsWith('/pairings/token')) return next();
    let clientKey = c.get('edgeClientKey');
    if (!clientKey) {
      if (config.edgeSharedSecret) throw new AppError('edge_identity_required', 'Start CLI login through the public site.', 401);
      // Self-hosting trusts the actual socket peer, never caller-supplied proxy/IP headers.
      let address: string | undefined;
      try { address = getConnInfo(c).remote.address; } catch { /* No Node socket in synthetic requests. */ }
      if (!address) throw new AppError('client_identity_unavailable', 'Client identity is unavailable.', 503);
      clientKey = createHmac('sha256', config.betterAuthSecret).update(`agent-client\n${address}`).digest('base64url');
    }
    const polling = c.req.path.endsWith('/token');
    await repo.limited(`${polling ? 'poll' : 'pairing'}:client:${clientKey}`, polling ? 60 : 10, polling ? 60 : 3600);
    await next();
  });
  app.post('/pairings', async (c) => {
    const text = await c.req.text();
    let raw: unknown;
    try { raw = text ? JSON.parse(text) : {}; } catch { throw new AppError('invalid_pairing', 'Submit a valid permission request.', 400); }
    const input = z.object({ canPublish: z.boolean().default(false) }).strict().safeParse(raw);
    if (!input.success) throw new AppError('invalid_pairing', 'Submit a valid permission request.', 400);
    const pairing = await repo.createPairing(input.data.canPublish);
    return c.json({ ...pairing, authorizationUrl: new URL(`/agent/authorize?code=${pairing.userCode}`, origin).href, permission: AGENT_PERMISSION }, 201);
  });
  app.post('/pairings/token', async (c) => {
    const body = z.object({ deviceCode: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict().safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new AppError('invalid_pairing', 'A valid device code is required.', 400);
    return c.json(await repo.redeem(body.data.deviceCode));
  });
  app.use('*', async (c, next) => {
    const authorization = c.req.header('authorization');
    if (!authorization?.startsWith('Bearer ')) throw new AppError('agent_unauthorized', 'Sign in with the CLI.', 401);
    const grant = await repo.grant(authorization.slice(7));
    c.set('agentUserId', grant.userId); c.set('agentGrantId', grant.id);
    c.set('agentExpiresAt', grant.expiresAt.toISOString()); c.set('agentCanPublish', grant.canPublish);
    await repo.limited(`requests:${grant.userId}`, 120, 60);
    await next();
  });
  app.get('/session', (c) => c.json({ permission: AGENT_PERMISSION, expiresAt: c.get('agentExpiresAt'), canPublish: c.get('agentCanPublish') }));
  app.delete('/session', async (c) => { await repo.revoke(c.get('agentUserId'), c.get('agentGrantId')); return c.json({ status: 'revoked' }); });
  app.get('/design/contract', (c) => c.json(designContractV2()));
  app.get('/context', async (c) => c.json(await database.transaction(async (db) => {
    await db.db.select({ id: blogs.id }).from(blogs).where(eq(blogs.userId, c.get('agentUserId'))).for('share');
    const blog = await db.getBlogForUser(c.get('agentUserId'));
    if (!blog) return { blog: null, canPublish: c.get('agentCanPublish'), publication: { status: 'not_published', publicUrl: null }, postCounts: { total: 0, selected: 0 }, sourceReady: false, draftReady: false, nextActions: agentNextActions(null, null), editorUrl: new URL('/editor', origin).href };
    const design = await db.getActiveDesign(blog.id);
    const release = await db.getActiveRelease(blog.id);
    const publicUrl = new URL(origin); publicUrl.hostname = `${blog.username}.${publicUrl.hostname}`;
    const operationId = (await db.getActiveOperation(blog.id, blog.userId))?.id ?? null;
    return {
      blog: { username: blog.username, hackmdUsername: blog.hackmdUsername, title: blog.title, description: blog.description, language: blog.language, state: blog.state },
      canPublish: c.get('agentCanPublish'),
      publication: { status: !release ? 'not_published' : release.contentVersion === blog.contentVersion && release.themeRevisionId === design?.id ? 'current' : 'changes_pending', publicUrl: release ? publicUrl.href : null },
      postCounts: { total: blog.contentManifest?.length ?? 0, selected: blog.contentManifest?.filter((post) => post.included).length ?? 0 },
      stateVersion: stateVersion(blog), design: design?.config ?? null, profile: blog.contentProfile,
      sourceReady: Boolean(blog.sourceArtifactId), draftReady: Boolean(blog.draftArtifactId),
      operationId, nextActions: agentNextActions(blog, operationId),
      editorUrl: new URL('/editor', origin).href,
    };
  })));
  app.get('/posts', async (c) => {
    const offset = Number(c.req.query('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new AppError('invalid_offset', 'Offset must be a non-negative integer.', 400);
    const blog = await database.getBlogForUser(c.get('agentUserId'));
    const posts = blog?.contentManifest ?? [];
    return c.json({ posts: posts.slice(offset, offset + 50).map(({ slug, title, description, publishedAt, included, tags }) => ({ slug, title, description, publishedAt, included, tags })), nextOffset: offset + 50 < posts.length ? offset + 50 : null });
  });
  app.get('/operations/:id', async (c) => {
    if (!z.uuid().safeParse(c.req.param('id')).success) throw new AppError('operation_not_found', 'Operation not found.', 404);
    const operation = await database.getOperation(c.req.param('id'), c.get('agentUserId'));
    if (!operation) throw new AppError('operation_not_found', 'Operation not found.', 404);
    return c.json({ id: operation.id, status: operation.status, message: operationMessage(operation), progress: operationProgress(operation), editorUrl: new URL('/editor', origin).href });
  });
  app.post('/design/validate', async (c) => {
    const input = z.object({ design: z.unknown() }).strict().safeParse(await c.req.json().catch(() => null));
    if (!input.success) throw new AppError('invalid_input', 'Submit an object containing design.', 400);
    const result = validateAgentDesign(input.data.design);
    return c.json(result, result.valid ? 200 : 422);
  });
  for (const action of ['connect', 'sync', 'identity', 'selection', 'design', 'publish'] as const) {
    app.post(`/${action}`, async (c) => {
      if (action === 'publish' && !c.get('agentCanPublish')) throw new AppError('publish_permission_required', 'Approve publishing access in the browser first.', 403);
      if (!c.req.header('content-type')?.startsWith('application/json')) throw new AppError('invalid_content_type', 'Use application/json.', 415);
      const key = c.req.header('idempotency-key');
      if (!key || !/^[A-Za-z0-9_-]{16,128}$/u.test(key)) throw new AppError('invalid_request_key', 'Supply a stable Idempotency-Key of 16–128 characters.', 400);
      const raw: unknown = await c.req.json().catch(() => null);
      const bodySchema = action === 'connect' ? connect : action === 'identity' ? z.object({ stateVersion: state, site: blogIdentitySchema.strict() }).strict()
        : action === 'selection' ? z.object({ stateVersion: state, excludedSlugs: z.array(z.string().min(1).max(200)).max(1000) }).strict()
          : action === 'design' ? z.object({ stateVersion: state, design: z.unknown() }).strict() : z.object({ stateVersion: state }).strict();
      const parsed = bodySchema.safeParse(raw);
      if (!parsed.success) throw new AppError('invalid_input', 'Check the input against the API contract.', 400);
      const body = parsed.data as Record<string, unknown>;
      let validated: ReturnType<typeof validateAgentDesign> | undefined;
      if (action === 'design') {
        validated = validateAgentDesign(body.design);
        if (!validated.valid) return c.json(validated, 422);
      }
      const design = validated?.valid ? validated.design : undefined;
      const result = await repo.mutation(c.get('agentUserId'), key, action, body, async (db, blog) => {
        if (action === 'connect') {
          const input = connect.parse(body);
          if (reserved.has(input.username)) throw new AppError('invalid_blog_address', 'Choose another blog address.', 400);
          if (!blog && input.stateVersion !== undefined) throw new AppError('state_changed', 'The blog changed. Read the context again.', 409);
          if (blog) {
            const same = blog.username === input.username && blog.hackmdUsername === input.hackmdUsername && blog.language === input.language;
            if (same && blog.draftArtifactId) return { status: 'unchanged' };
            return operationResult(await db.retryInitialSync(blog.userId, input));
          }
          try { return operationResult((await db.createBlog(c.get('agentUserId'), input.username, input.hackmdUsername, input.language)).operation); }
          catch (error) {
            if (error instanceof BlogAddressTakenError) throw new AppError('blog_address_taken', 'That blog address is already taken.', 409);
            if (error instanceof BlogAlreadyExistsError) throw new AppError('blog_already_connected', 'A blog was connected by another request. Read the context again.', 409);
            throw error;
          }
        }
        if (action === 'publish' && blog) {
          const operation = await db.createSavedDraftPublishOperation(blog.userId, blog.id);
          return operation ? operationResult(operation) : { status: 'unchanged' };
        }
        if (!blog?.sourceArtifactId) throw new AppError('draft_not_ready', 'Finish connecting and syncing first.', 409);
        if (action === 'design' && design) {
          const current = await db.getActiveDesign(blog.id);
          if (current && analyzeDesignImpact(current.config, design) === 'none') return { status: 'unchanged' };
          return operationResult(await db.createApplyDesignOperation(blog.userId, blog.id, design, '/', 'agent'));
        }
        if (action === 'identity') {
          const site = blogIdentitySchema.parse(body.site);
          if (site.title === blog.title && site.description === blog.description && site.language === blog.language) return { status: 'unchanged' };
          return operationResult(await db.createSyncOperation(blog.userId, blog.id, { intent: 'identity', site }));
        }
        if (action === 'selection') {
          const excludedSlugs = body.excludedSlugs as string[];
          if (!blog.contentManifest || new Set(excludedSlugs).size !== excludedSlugs.length || excludedSlugs.some((slug) => !blog.contentManifest?.some((post) => post.slug === slug))) throw new AppError('invalid_selection', 'Read the current posts before changing selection.', 409);
          if (excludedSlugs.length === blog.contentManifest.length) throw new AppError('no_articles_selected', 'Keep at least one article selected.', 400);
          if (blog.contentManifest.every((post) => post.included === !excludedSlugs.includes(post.slug))) return { status: 'unchanged' };
          return operationResult(await db.createSyncOperation(blog.userId, blog.id, { intent: 'selection', excludedSlugs }));
        }
        return operationResult(await db.createSyncOperation(blog.userId, blog.id, { intent: 'content' }));
      });
      if (result.operationId) await dispatcher.dispatch().catch(() => { console.error('agent_dispatch_deferred', { operationId: result.operationId }); });
      return c.json(result, result.operationId ? 202 : 200);
    });
  }
  app.all('*', (c) => c.json({ error: { code: 'not_found', message: 'Agent endpoint not found.', requestId: c.get('requestId') } }, 404));
  return app;
}
