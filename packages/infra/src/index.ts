import * as cloudflare from '@pulumi/cloudflare';
import * as gcp from '@pulumi/gcp';
import * as neon from '@pulumi/neon';
import * as pulumi from '@pulumi/pulumi';
import { ApplicationImage } from './application-image.js';
import { CloudflareDelivery } from './cloudflare-delivery.js';
import { DatabaseMigration } from './database-migration.js';
import { EmailFoundation } from './resend-foundation.js';
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
const zoneId = config.require('cloudflareZoneId');
const rootDomain = config.require('rootDomain');
const bucketName = config.get('r2BucketName') ?? `vibelog-${environment}-artifacts`;
const deployerServiceAccountEmail = `vibelog-deployer@${project}.iam.gserviceaccount.com`;
const gcpProvider = new gcp.Provider('gcp', { project });
const cloudflareR2Provider = new cloudflare.Provider('cloudflare-r2', { apiToken: config.requireSecret('cloudflareR2ApiToken') });
const cloudflareDeliveryProvider = new cloudflare.Provider('cloudflare-delivery', { apiToken: config.requireSecret('cloudflareDeliveryApiToken') });
const neonProvider = new neon.Provider('neon', { apiKey: config.requireSecret('neonApiKey') });
const foundation = new ProductionFoundation('foundation', {
  project,
  region,
  environment,
  cloudflareAccountId: accountId,
  r2BucketName: bucketName,
  r2Location: config.get('r2Location') ?? 'apac',
  neonOrgId: config.require('neonOrgId'),
  neonRegionId: config.require('neonRegionId'),
  neonProjectName: config.get('neonProjectName') ?? `vibelog-${environment}`,
  gcpProvider,
  cloudflareProvider: cloudflareR2Provider,
  neonProvider,
}, { providers: [gcpProvider, cloudflareR2Provider, neonProvider] });
const forwardingDestination = config.requireSecret('supportForwardingDestination');
const email = new EmailFoundation('email', {
  accountId,
  zoneId,
  rootDomain,
  forwardingDestination,
  resendManagementApiKey: config.requireSecret('resendManagementApiKey'),
  cloudflareProvider: cloudflareDeliveryProvider,
}, { providers: [cloudflareDeliveryProvider] });

function securePostgresUrl(uri: pulumi.Output<string>): pulumi.Output<string> {
  return uri.apply((value) => {
    const url = new URL(value);
    url.searchParams.set('sslmode', 'verify-full');
    url.searchParams.set('channel_binding', 'require');
    return url.toString();
  });
}

const databaseUrl = securePostgresUrl(foundation.database.connectionUriPooler);
const directDatabaseUrl = securePostgresUrl(foundation.database.connectionUri);

function createApplication() {
  const edgeSharedSecret = config.requireSecret('edgeSharedSecret');
  const image = new ApplicationImage('application-image', {
    project,
    region,
    environment,
    repository: foundation.repository,
  });
  const migration = new DatabaseMigration('database-migration', {
    databaseUrl: directDatabaseUrl,
    imageDigest: image.reference,
  }, { dependsOn: [foundation.database] });
  const runtime = new GcpContainerRuntime('runtime', {
    project,
    region,
    environment,
    imageDigest: image.reference,
    deployerServiceAccountEmail,
    appOrigin: pulumi.interpolate`https://${rootDomain}`,
    previewOrigin: pulumi.interpolate`https://preview.${rootDomain}`,
    objectStoreEndpoint: pulumi.interpolate`https://${accountId}.r2.cloudflarestorage.com`,
    objectStoreBucket: foundation.bucket.name,
    aiProvider: config.get('aiProvider') ?? 'openai',
    aiModel: config.get('aiModel') ?? 'gpt-4o-mini',
    aiApiKeyEnv: config.get('aiApiKeyEnv') ?? 'OPENAI_API_KEY',
    emailFrom: `VibeLog <login@send.${rootDomain}>`,
    emailReplyTo: `support@${rootDomain}`,
    minInstances: config.getNumber('minInstances') ?? 0,
    maxInstances: config.getNumber('maxInstances') ?? 3,
    provider: gcpProvider,
    secrets: {
      databaseUrl,
      objectStoreAccessKeyId: config.requireSecret('objectStoreAccessKeyId'),
      objectStoreSecretAccessKey: config.requireSecret('objectStoreSecretAccessKey'),
      resendApiKey: email.runtimeApiKeyToken,
      betterAuthSecret: config.requireSecret('betterAuthSecret'),
      aiApiKey: config.requireSecret('aiApiKey'),
      edgeSharedSecret,
    },
  }, { providers: [gcpProvider], dependsOn: [migration] });
  new CloudflareDelivery('delivery', {
    accountId,
    zoneId,
    rootDomain,
    originUrl: runtime.webUrl,
    edgeSharedSecret,
    supportAddress: `support@${rootDomain}`,
    forwardingDestination,
    forwardingAddress: email.forwardingAddress,
    provider: cloudflareDeliveryProvider,
  }, { providers: [cloudflareDeliveryProvider] });
  return { runtime, image };
}

const application = phase === 'application' ? createApplication() : undefined;

export const deploymentPhase = phase;
export const artifactRepository = foundation.repository.repositoryId;
export const r2Bucket = foundation.bucket.name;
export const databaseProjectId = foundation.database.id;
export const databaseMigrationUrl = directDatabaseUrl;
export const resendDomainId = email.domain.id;
export const resendDomainStatus = email.verification.status;
export const emailRoutingStatus = email.routingDns.status;
export const webUrl = application?.runtime.webUrl ?? pulumi.output('');
export const deployedImage = application?.image.reference ?? pulumi.output('');
export const workerUrl = application?.runtime.workerUrl ?? pulumi.output('');
export const taskQueuePath = application?.runtime.taskQueuePath ?? pulumi.output('');
export const taskInvokerEmail = application?.runtime.taskInvokerEmail ?? pulumi.output('');
