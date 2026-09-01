import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as cloudflare from '@pulumi/cloudflare';
import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CloudflareDelivery } from '../src/cloudflare-delivery.js';
import { GcpContainerRuntime } from '../src/gcp-container-runtime.js';
import { ProductionFoundation } from '../src/production-foundation.js';

interface Registration { type: string; name: string; inputs: Record<string, unknown>; provider?: string }
const registrations: Registration[] = [];
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}; }
async function resolveOutput<T>(output: pulumi.Output<T>): Promise<T> {
  return await new Promise<T>((resolveValue) => { void output.apply((value) => { resolveValue(value); return value; }); });
}
beforeAll(async () => {
  await pulumi.runtime.setMocks({
    newResource: (args) => {
      const inputs = record(args.inputs);
      registrations.push({ type: args.type, name: args.name, inputs, provider: args.provider });
      const state: Record<string, unknown> = { ...inputs, uri: `https://${args.name}.run.test`, name: inputs.name ?? args.name, secretId: inputs.secretId ?? args.name, repositoryId: inputs.repositoryId ?? args.name, email: `${args.name}@project.iam.gserviceaccount.com` };
      const traffics = Array.isArray(inputs.traffics) ? inputs.traffics.map(record) : [];
      if (args.type.includes('cloudrunv2/service:Service')) state.trafficStatuses = traffics.map((traffic) => ({ ...traffic, revision: traffic.revision ?? `${args.name}-revision`, uri: `https://${typeof traffic.tag === 'string' ? `${traffic.tag}---` : ''}${args.name}.run.test` }));
      return { id: `${args.name}-id`, state };
    },
    call: (args) => record(args.inputs),
  }, 'vibelog', 'prod', false, 'test-organization');
});
beforeEach(() => { registrations.length = 0; });
describe('Pulumi components', () => {
  it('keeps web public, worker private, bounded at zero-to-max, and secrets out of plaintext env', async () => {
    const childUrns: string[] = [];
    await pulumi.runtime.runInPulumiStack(async () => {
      const provider = new gcp.Provider('test-gcp', { project: 'vibelog-test-project', region: 'asia-east1' });
      const runtime = new GcpContainerRuntime('test-runtime', {
      project: 'vibelog-test-project', region: 'asia-east1', environment: 'prod', imageDigest: 'asia-east1-docker.pkg.dev/project/repo/app@sha256:abc',
      deployerServiceAccountEmail: 'vibelog-deployer@vibelog-test-project.iam.gserviceaccount.com',
      appOrigin: 'https://example.com', previewOrigin: 'https://preview.example.com', objectStoreEndpoint: 'https://account.r2.cloudflarestorage.com',
      objectStoreBucket: 'artifacts', githubClientId: 'github-id', googleClientId: 'google-id', aiProvider: 'openai', aiModel: 'gpt-4o-mini',
      aiApiKeyEnv: 'OPENAI_API_KEY', emailFrom: 'VibeLog <login@send.example.com>', emailReplyTo: 'support@example.com',
      minInstances: 0, maxInstances: 3, webActiveRevision: 'web-stable', workerActiveRevision: 'worker-stable', provider,
      secrets: { databaseUrl: pulumi.secret('database'), objectStoreAccessKeyId: pulumi.secret('key'), objectStoreSecretAccessKey: pulumi.secret('secret'), resendApiKey: pulumi.secret('resend'), betterAuthSecret: pulumi.secret('auth'), githubClientSecret: pulumi.secret('github'), googleClientSecret: pulumi.secret('google'), aiApiKey: pulumi.secret('ai'), edgeSharedSecret: pulumi.secret('edge') },
      }, { providers: [provider] });
      await resolveOutput(runtime.webUrl);
      expect(await resolveOutput(runtime.candidateWorkerUrl)).toBe('https://candidate---test-runtime-worker.run.test');
      expect(await resolveOutput(runtime.workerUrl)).toBe('https://test-runtime-worker.run.test');
      expect(await resolveOutput(runtime.taskQueuePath)).toBe('projects/vibelog-test-project/locations/asia-east1/queues/vibelog-operations-prod');
      expect(await resolveOutput(runtime.taskInvokerEmail)).toBe('test-runtime-tasks-sa@project.iam.gserviceaccount.com');
      childUrns.push(
        await resolveOutput(runtime.web.urn),
        await resolveOutput(runtime.worker.urn),
        await resolveOutput(runtime.queue.urn),
      );
    });
    const services = registrations.filter((item) => item.type.includes('cloudrunv2/service:Service'));
    expect(registrations.find((item) => item.type.includes('cloudtasks/queue:Queue'))?.inputs.retryConfig).toMatchObject({ maxAttempts: 100, minBackoff: '30s', maxBackoff: '300s' });
    expect(services).toHaveLength(2);
    const web = services.find((item) => item.name.endsWith('-web')); const worker = services.find((item) => item.name.endsWith('-worker'));
    expect(web).toBeDefined(); expect(worker).toBeDefined();
    if (!web || !worker) throw new Error('Cloud Run services missing');
    expect(web.inputs.ingress).toBe('INGRESS_TRAFFIC_ALL'); expect(worker.inputs.ingress).not.toBe('INGRESS_TRAFFIC_ALL');
    for (const service of services) {
      const template = service.inputs.template as { scaling: { minInstanceCount: number; maxInstanceCount: number }; containers: { envs: { name: string; value?: string; valueSource?: unknown }[] }[] };
      expect(template.scaling).toMatchObject({ minInstanceCount: 0, maxInstanceCount: 3 });
      expect(service.inputs.traffics).toEqual([
        { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: service.name.endsWith('-web') ? 'web-stable' : 'worker-stable', percent: 100 },
        { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 0, tag: 'candidate' },
      ]);
      const secretNames = new Set(['DATABASE_URL', 'RESEND_API_KEY', 'BETTER_AUTH_SECRET', 'OBJECT_STORE_SECRET_ACCESS_KEY']);
      const [container] = template.containers; if (!container) throw new Error('Cloud Run container missing');
      for (const env of container.envs.filter((item) => secretNames.has(item.name))) { expect(env.value).toBeUndefined(); expect(env.valueSource).toBeDefined(); }
    }
    const workerTemplate = worker.inputs.template as { containers: { envs: { name: string }[] }[] };
    const workerSecretNames = new Set(workerTemplate.containers[0]?.envs.map((env) => env.name) ?? []);
    expect(workerSecretNames.has('RESEND_API_KEY')).toBe(false);
    expect(workerSecretNames.has('BETTER_AUTH_SECRET')).toBe(false);
    expect(workerSecretNames.has('GITHUB_CLIENT_SECRET')).toBe(false);
    expect(workerSecretNames.has('GOOGLE_CLIENT_SECRET')).toBe(false);
    expect(workerSecretNames.has('EDGE_SHARED_SECRET')).toBe(false);
    expect(workerSecretNames.has('OPENAI_API_KEY')).toBe(true);
    const gcpChildren = registrations.filter((item) => item.type.startsWith('gcp:'));
    expect(gcpChildren.filter((item) => !item.provider).map((item) => item.name)).toEqual([]);
    expect(registrations.some((item) => item.type.includes('projects/service:Service'))).toBe(false);
    expect(registrations.some((item) => item.type.includes('projects/iAMMember:IAMMember'))).toBe(false);
    expect(registrations.some((item) => item.type.includes('artifactregistry/repository:Repository'))).toBe(false);
    const queueIamMembers = registrations.filter((item) => item.type.includes('cloudtasks/queueIamMember:QueueIamMember'));
    expect(queueIamMembers).toHaveLength(2);
    expect(queueIamMembers.every((item) => item.inputs.project === 'vibelog-test-project' && item.inputs.location === 'asia-east1' && item.inputs.name === 'vibelog-operations-prod' && item.inputs.role === 'roles/cloudtasks.enqueuer')).toBe(true);
    const deployerActAs = registrations.filter((item) => item.type.includes('serviceaccount/iAMMember:IAMMember') && item.name.includes('-deployer-'));
    expect(deployerActAs).toHaveLength(3);
    expect(deployerActAs.every((item) => item.inputs.role === 'roles/iam.serviceAccountUser' && item.inputs.member === 'serviceAccount:vibelog-deployer@vibelog-test-project.iam.gserviceaccount.com')).toBe(true);
    expect(childUrns).toHaveLength(3);
    expect(childUrns.every((urn) => urn.includes('vibelog:infra:GcpContainerRuntime$gcp:'))).toBe(true);
  });
  it('creates only the protected repository and private R2 bucket in the foundation', async () => {
    const childUrns: string[] = [];
    await pulumi.runtime.runInPulumiStack(async () => {
      const gcpProvider = new gcp.Provider('foundation-gcp', { project: 'vibelog-test-project', region: 'asia-east1' });
      const cloudflareProvider = new cloudflare.Provider('foundation-cloudflare', { apiToken: pulumi.secret('token') });
      const foundation = new ProductionFoundation('test-foundation', {
        project: 'vibelog-test-project', region: 'asia-east1', environment: 'prod', cloudflareAccountId: 'account',
        r2BucketName: 'vibelog-prod-artifacts', r2Location: 'apac', gcpProvider, cloudflareProvider,
      }, { providers: [gcpProvider, cloudflareProvider] });
      childUrns.push(await resolveOutput(foundation.repository.urn), await resolveOutput(foundation.bucket.urn));
    });
    const repository = registrations.find((item) => item.type.includes('artifactregistry/repository:Repository'));
    const bucket = registrations.find((item) => item.type.includes('r2Bucket:R2Bucket'));
    expect(repository?.inputs).toMatchObject({ project: 'vibelog-test-project', location: 'asia-east1', repositoryId: 'vibelog-prod', format: 'DOCKER' });
    expect(bucket?.inputs).toMatchObject({ accountId: 'account', name: 'vibelog-prod-artifacts', location: 'apac', storageClass: 'Standard' });
    expect(childUrns).toHaveLength(2);
    expect(childUrns.every((urn) => urn.includes('vibelog:infra:ProductionFoundation$'))).toBe(true);
    expect(readFileSync(fileURLToPath(new URL('../src/production-foundation.ts', import.meta.url)), 'utf8').match(/protect: true/g)).toHaveLength(2);
    expect(registrations.some((item) => /r2(Custom|Managed)Domain/.test(item.type))).toBe(false);
  });
  it('routes both the apex and first-level hosts through the edge without owning R2', async () => {
    await pulumi.runtime.runInPulumiStack(async () => {
      const provider = new cloudflare.Provider('test-cloudflare', { apiToken: pulumi.secret('token') });
      const delivery = new CloudflareDelivery('test-delivery', { accountId: 'account', zoneId: 'zone', rootDomain: 'example.com', originUrl: 'https://web.run.test', edgeSharedSecret: pulumi.secret('edge'), provider, bundlePath: fileURLToPath(new URL('./fixture-worker.js', import.meta.url)) }, { providers: [provider] });
      await resolveOutput(delivery.script.scriptName);
      await Promise.all(delivery.routes.map((route) => resolveOutput(route.pattern)));
    });
    const script = registrations.find((item) => item.type.includes('workersScript:WorkersScript'));
    expect(script).toBeDefined();
    if (!script) throw new Error('Cloudflare Worker missing');
    expect(registrations.some((item) => item.type.includes('r2Bucket:R2Bucket'))).toBe(false);
    expect(script.inputs.compatibilityDate).toBe('2026-08-29');
    const routes = registrations.filter((item) => item.type.includes('workersRoute:WorkersRoute')).map((item) => item.inputs.pattern);
    expect(routes.sort()).toEqual(['*.example.com/*', 'example.com/*']);
    const dns = registrations.filter((item) => item.type.includes('dnsRecord:DnsRecord'));
    expect(dns.map((item) => item.inputs.name).sort()).toEqual(['*.example.com', 'example.com']);
    expect(dns.every((item) => item.inputs.proxied === true)).toBe(true);
  });
});
