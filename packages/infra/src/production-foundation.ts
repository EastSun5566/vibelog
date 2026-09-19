import * as cloudflare from '@pulumi/cloudflare';
import * as neon from '@pulumi/neon';
import * as pulumi from '@pulumi/pulumi';

export interface ProductionFoundationArgs {
  cloudflareAccountId: pulumi.Input<string>;
  r2BucketName: pulumi.Input<string>;
  r2Location: pulumi.Input<string>;
  neonOrgId: pulumi.Input<string>;
  neonRegionId: pulumi.Input<string>;
  neonProjectName: pulumi.Input<string>;
  cloudflareProvider: cloudflare.Provider;
  neonProvider: neon.Provider;
}

export class ProductionFoundation extends pulumi.ComponentResource {
  readonly bucket: cloudflare.R2Bucket;
  readonly database: neon.Project;

  constructor(name: string, args: ProductionFoundationArgs, opts?: pulumi.ComponentResourceOptions) {
    super('vibelog:infra:ProductionFoundation', name, {}, opts);
    this.bucket = new cloudflare.R2Bucket(`${name}-artifacts`, {
      accountId: args.cloudflareAccountId,
      name: args.r2BucketName,
      location: args.r2Location,
      storageClass: 'Standard',
    }, { parent: this, provider: args.cloudflareProvider, protect: true });
    this.database = new neon.Project(`${name}-database`, {
      name: args.neonProjectName,
      orgId: args.neonOrgId,
      regionId: args.neonRegionId,
      pgVersion: 17,
      branch: {
        name: 'main',
        databaseName: 'vibelog',
        roleName: 'vibelog_owner',
      },
      defaultBranchProtected: false,
      defaultEndpointSettings: {
        autoscalingLimitMinCu: 0.25,
        autoscalingLimitMaxCu: 0.25,
        suspendTimeoutSeconds: 0,
      },
      historyRetentionSeconds: 21600,
      storePassword: 'yes',
    }, {
      parent: this,
      provider: args.neonProvider,
      protect: true,
    });
    this.registerOutputs({
      bucketName: this.bucket.name,
      databaseProjectId: this.database.id,
    });
  }
}
