import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  HackMdSource,
  NotionSource,
  buildFromVibelog,
  createAiProvider,
  createDevBuilder,
  createStyleTransformer,
} from '@vibelog/core';
import type { AppConfig } from './config.js';
import type { AppDatabase, JobRecord, ProjectRecord } from './database.js';
import { deployToCloudflarePages } from './deploy/cloudflare.js';
import { decryptJson } from './security/crypto.js';
import { projectRoot } from './security/path.js';

interface CloudflareSecret { apiToken: string; accountId: string }
interface NotionSecret { token: string }

function publicError(error: unknown, config: AppConfig): string {
  const message = error instanceof Error ? error.message : 'Job failed';
  const environmentSecrets = Object.entries(process.env)
    .flatMap(([name, value]) => value && value.length >= 8 && /(?:token|secret|api.?key|password)/i.test(name) ? [value] : []);
  return [config.dataRoot, ...environmentSecrets]
    .reduce((output, secret) => output.replaceAll(secret, '[REDACTED]'), message)
    .replaceAll(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[REDACTED]')
    .slice(0, 500);
}

function sourceFor(database: AppDatabase, config: AppConfig, project: ProjectRecord) {
  if (project.sourceType === 'hackmd') {
    const username = project.sourceConfig.username;
    if (typeof username !== 'string') throw new Error('Invalid HackMD source configuration');
    return new HackMdSource(username);
  }
  const databaseId = project.sourceConfig.databaseId;
  const credentialId = project.sourceConfig.credentialId;
  if (typeof databaseId !== 'string' || typeof credentialId !== 'string') {
    throw new Error('Invalid Notion source configuration');
  }
  const credential = database.getCredential(credentialId, project.userId, 'notion');
  if (!credential) throw new Error('Notion credential not found');
  const secret = decryptJson(credential, config.encryptionKey) as NotionSecret;
  return new NotionSource(databaseId, { token: secret.token });
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const staging = `${path}.${randomUUID()}.tmp`;
  await writeFile(staging, content, { encoding: 'utf8', mode: 0o600 });
  await rename(staging, path);
}

export class JobWorker {
  private stopped = false;

  constructor(private readonly database: AppDatabase, private readonly config: AppConfig) {}

  async execute(job: JobRecord): Promise<Record<string, unknown>> {
    const project = this.database.getProject(job.projectId, job.userId);
    if (!project) throw new Error('Project not found');
    const root = projectRoot(this.config.dataRoot, project.userId, project.id);

    switch (job.type) {
    case 'sync': {
      await mkdir(root, { recursive: true, mode: 0o700 });
      if (typeof project.sourceConfig.language === 'string') {
        await atomicWrite(join(root, 'vibelog.config.json'), JSON.stringify({ site: { language: project.sourceConfig.language } }));
      }
      const builder = createDevBuilder({ root, contentSource: sourceFor(this.database, this.config, project) });
      await builder.prepare({ installDependencies: false });
      await builder.fetchContent();
      this.database.updateProjectState(project.id, 'ready');
      return { synced: true };
    }
    case 'build':
      this.database.updateProjectState(project.id, 'building');
      await buildFromVibelog({
        vibelogDir: join(root, '.vibelog'),
        outDir: join(root, 'dist'),
        site: typeof job.payload.site === 'string' ? job.payload.site : this.config.previewOrigin,
      });
      this.database.updateProjectState(project.id, 'ready');
      return { built: true };
    case 'style': {
      const prompt = job.payload.prompt;
      if (typeof prompt !== 'string') throw new Error('Style prompt is required');
      const cssPath = join(root, '.vibelog', 'src', 'styles', 'global.css');
      const transformer = createStyleTransformer({ aiProvider: createAiProvider(this.config.aiProvider, this.config.aiModel) });
      const result = await transformer.transform({ originalCss: await readFile(cssPath, 'utf8'), stylePrompt: prompt });
      await atomicWrite(cssPath, result.transformedCss);
      return { description: result.description };
    }
    case 'deploy': {
      const credentialId = job.payload.credentialId;
      const projectName = job.payload.projectName;
      if (typeof credentialId !== 'string' || typeof projectName !== 'string') {
        throw new Error('Cloudflare credential and project name are required');
      }
      const credential = this.database.getCredential(credentialId, project.userId, 'cloudflare');
      if (!credential) throw new Error('Cloudflare credential not found');
      const secret = decryptJson(credential, this.config.encryptionKey) as CloudflareSecret;
      const result = await deployToCloudflarePages(join(root, 'dist'), {
        ...secret,
        projectName,
        branch: typeof job.payload.branch === 'string' ? job.payload.branch : 'main',
      });
      this.database.createDeployment(project.id, {
        providerDeploymentId: result.deploymentId,
        url: result.url,
        environment: result.environment,
      });
      return { url: result.url, environment: result.environment };
    }
    case 'delete':
      this.database.updateProjectState(project.id, 'deleting');
      await rm(root, { recursive: true, force: true });
      return { deleted: true };
    }
  }

  async runOnce(): Promise<boolean> {
    const job = this.database.claimNextJob();
    if (!job) return false;
    try {
      this.database.completeJob(job.id, await this.execute(job));
      if (job.type === 'delete') this.database.markProjectDeleted(job.projectId);
    } catch (error) {
      const message = publicError(error, this.config);
      this.database.failJob(job.id, 'job_failed', message);
      this.database.updateProjectState(job.projectId, 'failed', message);
    }
    return true;
  }

  async run(pollMs = 500): Promise<void> {
    this.database.recoverRunningJobs();
    while (!this.stopped) {
      if (!await this.runOnce()) await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  stop(): void { this.stopped = true; }
}
