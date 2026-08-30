import * as cloudflare from '@pulumi/cloudflare';
import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import { CloudflareDelivery } from './cloudflare-delivery.js';
import { GcpContainerRuntime } from './gcp-container-runtime.js';

const config = new pulumi.Config('vibelog'); const gcpConfig = new pulumi.Config('gcp');
const environment = config.require('environment'); const project = gcpConfig.require('project'); const region = gcpConfig.require('region');
const rootDomain = config.require('rootDomain'); const accountId = config.require('cloudflareAccountId'); const zoneId = config.require('cloudflareZoneId');
const imageDigest = config.require('imageDigest'); const bucketName = config.get('r2BucketName') ?? `vibelog-${environment}-artifacts`;
const edgeSharedSecret = config.requireSecret('edgeSharedSecret'); const cloudflareApiToken = config.requireSecret('cloudflareApiToken');
const gcpProvider = new gcp.Provider('gcp', { project, region });
const cloudflareProvider = new cloudflare.Provider('cloudflare', { apiToken: cloudflareApiToken });
const objectStoreEndpoint = pulumi.interpolate`https://${accountId}.r2.cloudflarestorage.com`;
const appOrigin = pulumi.interpolate`https://app.${rootDomain}`; const previewOrigin = pulumi.interpolate`https://preview.${rootDomain}`;

const runtime = new GcpContainerRuntime('runtime', {
  project, region, environment, imageDigest, appOrigin, previewOrigin, objectStoreEndpoint, objectStoreBucket: bucketName,
  githubClientId: config.require('githubClientId'), googleClientId: config.require('googleClientId'),
  aiProvider: config.get('aiProvider') ?? 'openai', aiModel: config.get('aiModel') ?? 'gpt-4o-mini',
  aiApiKeyEnv: config.get('aiApiKeyEnv') ?? 'OPENAI_API_KEY', emailFrom: config.require('emailFrom'),
  emailReplyTo: config.require('emailReplyTo'), minInstances: config.getNumber('minInstances') ?? 0,
  maxInstances: config.getNumber('maxInstances') ?? 3, webActiveRevision: config.get('webActiveRevision'),
  workerActiveRevision: config.get('workerActiveRevision'), provider: gcpProvider,
  secrets: {
    databaseUrl: config.requireSecret('databaseUrl'), objectStoreAccessKeyId: config.requireSecret('objectStoreAccessKeyId'),
    objectStoreSecretAccessKey: config.requireSecret('objectStoreSecretAccessKey'), resendApiKey: config.requireSecret('resendApiKey'),
    betterAuthSecret: config.requireSecret('betterAuthSecret'), githubClientSecret: config.requireSecret('githubClientSecret'),
    googleClientSecret: config.requireSecret('googleClientSecret'), aiApiKey: config.requireSecret('aiApiKey'), edgeSharedSecret,
  },
}, { providers: [gcpProvider] });
const delivery = new CloudflareDelivery('delivery', {
  accountId, zoneId, rootDomain, bucketName, location: config.get('r2Location') ?? 'apac',
  originUrl: runtime.webUrl, edgeSharedSecret, provider: cloudflareProvider,
}, { providers: [cloudflareProvider] });

export const webUrl = runtime.webUrl;
export const deployedImage = pulumi.output(imageDigest);
export const webServingRevision = runtime.webServingRevision;
export const workerServingRevision = runtime.workerServingRevision;
export const candidateWebUrl = runtime.candidateWebUrl;
export const candidateWorkerUrl = runtime.candidateWorkerUrl;
export const workerUrl = runtime.workerUrl;
export const taskQueuePath = runtime.taskQueuePath;
export const taskInvokerEmail = runtime.taskInvokerEmail;
export const r2Bucket = delivery.bucket.name;
export const artifactRepository = runtime.repository.repositoryId;
