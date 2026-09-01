import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';

export interface RuntimeSecretInputs {
  databaseUrl: pulumi.Input<string>; objectStoreAccessKeyId: pulumi.Input<string>; objectStoreSecretAccessKey: pulumi.Input<string>;
  resendApiKey: pulumi.Input<string>; betterAuthSecret: pulumi.Input<string>; githubClientSecret: pulumi.Input<string>;
  googleClientSecret: pulumi.Input<string>; aiApiKey: pulumi.Input<string>; edgeSharedSecret: pulumi.Input<string>;
}
export interface GcpContainerRuntimeArgs {
  project: pulumi.Input<string>; region: pulumi.Input<string>; environment: string; imageDigest: pulumi.Input<string>;
  deployerServiceAccountEmail: pulumi.Input<string>;
  appOrigin: pulumi.Input<string>; previewOrigin: pulumi.Input<string>; objectStoreEndpoint: pulumi.Input<string>;
  objectStoreBucket: pulumi.Input<string>; githubClientId: pulumi.Input<string>; googleClientId: pulumi.Input<string>;
  aiProvider: pulumi.Input<string>; aiModel: pulumi.Input<string>; aiApiKeyEnv: pulumi.Input<string>;
  emailFrom: pulumi.Input<string>; emailReplyTo: pulumi.Input<string>; minInstances: pulumi.Input<number>;
  maxInstances: pulumi.Input<number>; webActiveRevision?: pulumi.Input<string>; workerActiveRevision?: pulumi.Input<string>;
  secrets: RuntimeSecretInputs; provider: gcp.Provider;
}
export class GcpContainerRuntime extends pulumi.ComponentResource {
  readonly web: gcp.cloudrunv2.Service;
  readonly worker: gcp.cloudrunv2.Service;
  readonly queue: gcp.cloudtasks.Queue;
  readonly webUrl: pulumi.Output<string>;
  readonly webServingRevision: pulumi.Output<string>;
  readonly workerServingRevision: pulumi.Output<string>;
  readonly candidateWebUrl: pulumi.Output<string>;
  readonly candidateWorkerUrl: pulumi.Output<string>;
  readonly workerUrl: pulumi.Output<string>;
  readonly taskQueuePath: pulumi.Output<string>;
  readonly taskInvokerEmail: pulumi.Output<string>;
  constructor(name: string, args: GcpContainerRuntimeArgs, opts?: pulumi.ComponentResourceOptions) {
    super('vibelog:infra:GcpContainerRuntime', name, {}, opts);
    const resourceOptions = { parent: this, provider: args.provider };
    const webAccount = new gcp.serviceaccount.Account(`${name}-web-sa`, { project: args.project, accountId: `vibelog-web-${args.environment}`, displayName: 'VibeLog web runtime' }, resourceOptions);
    const workerAccount = new gcp.serviceaccount.Account(`${name}-worker-sa`, { project: args.project, accountId: `vibelog-worker-${args.environment}`, displayName: 'VibeLog worker runtime' }, resourceOptions);
    const tasksAccount = new gcp.serviceaccount.Account(`${name}-tasks-sa`, { project: args.project, accountId: `vibelog-tasks-${args.environment}`, displayName: 'Cloud Tasks caller' }, resourceOptions);
    const deployerMember = pulumi.interpolate`serviceAccount:${args.deployerServiceAccountEmail}`;
    for (const [kind, account] of Object.entries({ web: webAccount, worker: workerAccount, tasks: tasksAccount })) {
      new gcp.serviceaccount.IAMMember(`${name}-deployer-${kind}-admin`, { serviceAccountId: account.name, role: 'roles/iam.serviceAccountAdmin', member: deployerMember }, resourceOptions);
    }
    const deployerActAs = {
      web: new gcp.serviceaccount.IAMMember(`${name}-deployer-web-identity`, { serviceAccountId: webAccount.name, role: 'roles/iam.serviceAccountUser', member: deployerMember }, resourceOptions),
      worker: new gcp.serviceaccount.IAMMember(`${name}-deployer-worker-identity`, { serviceAccountId: workerAccount.name, role: 'roles/iam.serviceAccountUser', member: deployerMember }, resourceOptions),
      tasks: new gcp.serviceaccount.IAMMember(`${name}-deployer-tasks-identity`, { serviceAccountId: tasksAccount.name, role: 'roles/iam.serviceAccountUser', member: deployerMember }, resourceOptions),
    };
    // Delivery retries must outlive the 35-minute operation lease; execution is capped separately in PostgreSQL.
    this.queue = new gcp.cloudtasks.Queue(`${name}-operations`, { project: args.project, location: args.region, name: `vibelog-operations-${args.environment}`, rateLimits: { maxConcurrentDispatches: 10, maxDispatchesPerSecond: 5 }, retryConfig: { maxAttempts: 100, maxBackoff: '300s', minBackoff: '30s', maxDoublings: 5 } }, resourceOptions);
    const secretValues: Record<string, { value: pulumi.Input<string>; services: ('web' | 'worker')[] }> = {
      DATABASE_URL: { value: args.secrets.databaseUrl, services: ['web', 'worker'] },
      OBJECT_STORE_ACCESS_KEY_ID: { value: args.secrets.objectStoreAccessKeyId, services: ['web', 'worker'] },
      OBJECT_STORE_SECRET_ACCESS_KEY: { value: args.secrets.objectStoreSecretAccessKey, services: ['web', 'worker'] },
      RESEND_API_KEY: { value: args.secrets.resendApiKey, services: ['web'] },
      BETTER_AUTH_SECRET: { value: args.secrets.betterAuthSecret, services: ['web'] },
      GITHUB_CLIENT_SECRET: { value: args.secrets.githubClientSecret, services: ['web'] },
      GOOGLE_CLIENT_SECRET: { value: args.secrets.googleClientSecret, services: ['web'] },
      EDGE_SHARED_SECRET: { value: args.secrets.edgeSharedSecret, services: ['web'] },
      AI_API_KEY: { value: args.secrets.aiApiKey, services: ['worker'] },
    };
    const managedSecrets = Object.fromEntries(Object.entries(secretValues).map(([envName, definition]) => {
      const id = `vibelog-${args.environment}-${envName.toLowerCase().replaceAll('_', '-')}`;
      const secret = new gcp.secretmanager.Secret(`${name}-${envName}`, { project: args.project, secretId: id, replication: { auto: {} } }, { ...resourceOptions, protect: true });
      new gcp.secretmanager.SecretVersion(`${name}-${envName}-version`, { secret: secret.id, secretData: pulumi.secret(definition.value) }, { ...resourceOptions, parent: secret });
      for (const kind of definition.services) {
        const account = kind === 'web' ? webAccount : workerAccount;
        new gcp.secretmanager.SecretIamMember(`${name}-${envName}-${kind}-access`, { project: args.project, secretId: secret.secretId, role: 'roles/secretmanager.secretAccessor', member: pulumi.interpolate`serviceAccount:${account.email}` }, resourceOptions);
      }
      return [envName, { secret, services: definition.services }] as const;
    }));
    const secretEnv = (kind: 'web' | 'worker') => Object.entries(managedSecrets).filter(([, definition]) => definition.services.includes(kind)).map(([envName, definition]) => ({ name: envName === 'AI_API_KEY' ? args.aiApiKeyEnv : envName, valueSource: { secretKeyRef: { secret: definition.secret.secretId, version: 'latest' } } }));
    const operationEnv = [
      { name: 'NODE_ENV', value: 'production' }, { name: 'APP_ORIGIN', value: args.appOrigin },
      { name: 'OBJECT_STORE_ENDPOINT', value: args.objectStoreEndpoint }, { name: 'OBJECT_STORE_REGION', value: 'auto' },
      { name: 'OBJECT_STORE_BUCKET', value: args.objectStoreBucket }, { name: 'OBJECT_STORE_FORCE_PATH_STYLE', value: 'false' },
      { name: 'VIBELOG_AI_PROVIDER', value: args.aiProvider }, { name: 'VIBELOG_AI_MODEL', value: args.aiModel },
    ];
    const webEnv = [
      { name: 'PREVIEW_ORIGIN', value: args.previewOrigin },
      { name: 'EMAIL_FROM', value: args.emailFrom }, { name: 'EMAIL_REPLY_TO', value: args.emailReplyTo },
      { name: 'GITHUB_CLIENT_ID', value: args.githubClientId }, { name: 'GOOGLE_CLIENT_ID', value: args.googleClientId },
    ];
    const service = (kind: 'web' | 'worker', account: gcp.serviceaccount.Account, command: string, activeRevision: pulumi.Input<string> | undefined, extraEnv: gcp.types.input.cloudrunv2.ServiceTemplateContainerEnv[]) =>
      new gcp.cloudrunv2.Service(`${name}-${kind}`, {
        project: args.project, location: args.region, name: `vibelog-${kind}-${args.environment}`,
        ingress: kind === 'web' ? 'INGRESS_TRAFFIC_ALL' : 'INGRESS_TRAFFIC_INTERNAL_ONLY',
        template: { serviceAccount: account.email, timeout: kind === 'worker' ? '3600s' : '300s', scaling: { minInstanceCount: args.minInstances, maxInstanceCount: args.maxInstances }, containers: [{ image: args.imageDigest, commands: ['node'], args: [command], envs: [...operationEnv, ...(kind === 'web' ? webEnv : []), ...secretEnv(kind), ...extraEnv], startupProbe: { httpGet: { path: '/health' }, initialDelaySeconds: 0, timeoutSeconds: 3, periodSeconds: 3, failureThreshold: 20 }, resources: { limits: { cpu: kind === 'worker' ? '2' : '1', memory: kind === 'worker' ? '2Gi' : '512Mi' }, cpuIdle: true } }] },
        traffics: activeRevision ? [
          { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: activeRevision, percent: 100 },
          { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 0, tag: 'candidate' },
        ] : [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100, tag: 'candidate' }],
      }, { ...resourceOptions, dependsOn: deployerActAs[kind] });
    const projectInfo = gcp.organizations.getProjectOutput({ projectId: args.project }, { provider: args.provider });
    const workerServiceUrl = pulumi.interpolate`https://vibelog-worker-${args.environment}-${projectInfo.number}.${args.region}.run.app`;
    const queueEnv = (workerUrl: pulumi.Input<string>) => [
      { name: 'OPERATION_QUEUE', value: 'cloud-tasks' }, { name: 'CLOUD_TASKS_PROJECT', value: args.project },
      { name: 'CLOUD_TASKS_LOCATION', value: args.region }, { name: 'CLOUD_TASKS_QUEUE', value: this.queue.name },
      { name: 'WORKER_URL', value: workerUrl },
      { name: 'CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL', value: tasksAccount.email },
    ];
    this.worker = service('worker', workerAccount, 'dist/worker-main.js', args.workerActiveRevision, [{ name: 'TASK_QUEUE_NAME', value: this.queue.name }, ...queueEnv(workerServiceUrl)]);
    this.web = service('web', webAccount, 'dist/web-main.js', args.webActiveRevision, queueEnv(this.worker.uri));
    new gcp.cloudrunv2.ServiceIamMember(`${name}-web-public`, { project: args.project, location: args.region, name: this.web.name, role: 'roles/run.invoker', member: 'allUsers' }, resourceOptions);
    new gcp.cloudrunv2.ServiceIamMember(`${name}-worker-tasks`, { project: args.project, location: args.region, name: this.worker.name, role: 'roles/run.invoker', member: pulumi.interpolate`serviceAccount:${tasksAccount.email}` }, resourceOptions);
    new gcp.cloudtasks.QueueIamMember(`${name}-web-enqueuer`, { project: args.project, location: args.region, name: this.queue.name, role: 'roles/cloudtasks.enqueuer', member: pulumi.interpolate`serviceAccount:${webAccount.email}` }, resourceOptions);
    new gcp.cloudtasks.QueueIamMember(`${name}-worker-enqueuer`, { project: args.project, location: args.region, name: this.queue.name, role: 'roles/cloudtasks.enqueuer', member: pulumi.interpolate`serviceAccount:${workerAccount.email}` }, resourceOptions);
    new gcp.serviceaccount.IAMMember(`${name}-web-task-identity`, { serviceAccountId: tasksAccount.name, role: 'roles/iam.serviceAccountUser', member: pulumi.interpolate`serviceAccount:${webAccount.email}` }, resourceOptions);
    new gcp.serviceaccount.IAMMember(`${name}-worker-task-identity`, { serviceAccountId: tasksAccount.name, role: 'roles/iam.serviceAccountUser', member: pulumi.interpolate`serviceAccount:${workerAccount.email}` }, resourceOptions);
    for (const [schedule, path] of [['outbox', '/tasks/outbox'], ['maintenance', '/tasks/maintenance']] as const) new gcp.cloudscheduler.Job(`${name}-${schedule}`, { project: args.project, region: args.region, name: `vibelog-${schedule}-${args.environment}`, schedule: schedule === 'outbox' ? '*/5 * * * *' : '17 * * * *', timeZone: 'Etc/UTC', httpTarget: { httpMethod: 'POST', uri: pulumi.interpolate`${this.worker.uri}${path}`, oidcToken: { serviceAccountEmail: tasksAccount.email, audience: this.worker.uri } } }, { ...resourceOptions, dependsOn: [this.worker, deployerActAs.tasks] });
    this.webUrl = this.web.uri;
    this.webServingRevision = this.web.trafficStatuses.apply((statuses) => statuses.find((status) => status.percent === 100)?.revision ?? '');
    this.workerServingRevision = this.worker.trafficStatuses.apply((statuses) => statuses.find((status) => status.percent === 100)?.revision ?? '');
    this.candidateWebUrl = this.web.trafficStatuses.apply((statuses) => statuses.find((status) => status.tag === 'candidate')?.uri ?? '');
    this.candidateWorkerUrl = this.worker.trafficStatuses.apply((statuses) => statuses.find((status) => status.tag === 'candidate')?.uri ?? '');
    this.workerUrl = this.worker.uri;
    this.taskQueuePath = pulumi.interpolate`projects/${args.project}/locations/${args.region}/queues/${this.queue.name}`;
    this.taskInvokerEmail = tasksAccount.email;
    this.registerOutputs({ webUrl: this.webUrl, webServingRevision: this.webServingRevision, workerServingRevision: this.workerServingRevision, candidateWebUrl: this.candidateWebUrl, candidateWorkerUrl: this.candidateWorkerUrl, workerUrl: this.workerUrl, taskQueuePath: this.taskQueuePath, taskInvokerEmail: this.taskInvokerEmail, workerName: this.worker.name, queueName: this.queue.name });
  }
}
