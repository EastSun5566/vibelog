import * as cloudflare from '@pulumi/cloudflare';
import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import { CloudflareDelivery } from './cloudflare-delivery.js';
import { GcpContainerRuntime } from './gcp-container-runtime.js';
import { ProductionFoundation } from './production-foundation.js';

const config = new pulumi.Config('vibelog');
const gcpConfig = new pulumi.Config('gcp');
const phase = config.require('deploymentPhase');
if (phase !== 'foundation' && phase !== 'application') throw new Error('vibelog:deploymentPhase must be foundation or application');

const environment = config.require('environment');
const project = gcpConfig.require('project');
const region = config.require('gcpRegion');
const accountId = config.require('cloudflareAccountId');
const bucketName = config.get('r2BucketName') ?? `vibelog-${environment}-artifacts`;
const gcpProvider = new gcp.Provider('gcp', { project });
const cloudflareR2Provider = new cloudflare.Provider('cloudflare-r2', { apiToken: config.requireSecret('cloudflareR2ApiToken') });
const foundation = new ProductionFoundation('foundation', {
  project,
  region,
  environment,
  cloudflareAccountId: accountId,
  r2BucketName: bucketName,
  r2Location: config.get('r2Location') ?? 'apac',
  gcpProvider,
  cloudflareProvider: cloudflareR2Provider,
}, { providers: [gcpProvider, cloudflareR2Provider] });

function createApplication() {
  const rootDomain = config.require('rootDomain');
  const zoneId = config.require('cloudflareZoneId');
  const imageDigest = config.require('imageDigest');
  const edgeSharedSecret = config.requireSecret('edgeSharedSecret');
  const cloudflareDeliveryProvider = new cloudflare.Provider('cloudflare-delivery', { apiToken: config.requireSecret('cloudflareDeliveryApiToken') });
  const runtime = new GcpContainerRuntime('runtime', {
    project,
    region,
    environment,
    imageDigest,
    appOrigin: pulumi.interpolate`https://${rootDomain}`,
    previewOrigin: pulumi.interpolate`https://preview.${rootDomain}`,
    objectStoreEndpoint: pulumi.interpolate`https://${accountId}.r2.cloudflarestorage.com`,
    objectStoreBucket: foundation.bucket.name,
    githubClientId: config.require('githubClientId'),
    googleClientId: config.require('googleClientId'),
    aiProvider: config.get('aiProvider') ?? 'openai',
    aiModel: config.get('aiModel') ?? 'gpt-4o-mini',
    aiApiKeyEnv: config.get('aiApiKeyEnv') ?? 'OPENAI_API_KEY',
    emailFrom: config.require('emailFrom'),
    emailReplyTo: config.require('emailReplyTo'),
    minInstances: config.getNumber('minInstances') ?? 0,
    maxInstances: config.getNumber('maxInstances') ?? 3,
    webActiveRevision: config.get('webActiveRevision'),
    workerActiveRevision: config.get('workerActiveRevision'),
    provider: gcpProvider,
    secrets: {
      databaseUrl: config.requireSecret('databaseUrl'),
      objectStoreAccessKeyId: config.requireSecret('objectStoreAccessKeyId'),
      objectStoreSecretAccessKey: config.requireSecret('objectStoreSecretAccessKey'),
      resendApiKey: config.requireSecret('resendApiKey'),
      betterAuthSecret: config.requireSecret('betterAuthSecret'),
      githubClientSecret: config.requireSecret('githubClientSecret'),
      googleClientSecret: config.requireSecret('googleClientSecret'),
      aiApiKey: config.requireSecret('aiApiKey'),
      edgeSharedSecret,
    },
  }, { providers: [gcpProvider] });
  new CloudflareDelivery('delivery', {
    accountId,
    zoneId,
    rootDomain,
    originUrl: runtime.webUrl,
    edgeSharedSecret,
    provider: cloudflareDeliveryProvider,
  }, { providers: [cloudflareDeliveryProvider] });
  return { runtime, imageDigest };
}

const application = phase === 'application' ? createApplication() : undefined;

export const deploymentPhase = phase;
export const artifactRepository = foundation.repository.repositoryId;
export const r2Bucket = foundation.bucket.name;
export const webUrl = application?.runtime.webUrl;
export const deployedImage = application ? pulumi.output(application.imageDigest) : undefined;
export const webServingRevision = application?.runtime.webServingRevision;
export const workerServingRevision = application?.runtime.workerServingRevision;
export const candidateWebUrl = application?.runtime.candidateWebUrl;
export const candidateWorkerUrl = application?.runtime.candidateWorkerUrl;
export const workerUrl = application?.runtime.workerUrl;
export const taskQueuePath = application?.runtime.taskQueuePath;
export const taskInvokerEmail = application?.runtime.taskInvokerEmail;
