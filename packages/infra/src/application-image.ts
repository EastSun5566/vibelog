import { fileURLToPath } from 'node:url';
import * as dockerBuild from '@pulumi/docker-build';
import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';

export interface ApplicationImageArgs {
  project: pulumi.Input<string>;
  region: pulumi.Input<string>;
  environment: string;
  repository: gcp.artifactregistry.Repository;
}

/** Builds and pushes the immutable application image consumed by both Cloud Run services. */
export class ApplicationImage extends pulumi.ComponentResource {
  readonly image: dockerBuild.Image;
  readonly reference: pulumi.Output<string>;

  constructor(name: string, args: ApplicationImageArgs, opts?: pulumi.ComponentResourceOptions) {
    super('vibelog:infra:ApplicationImage', name, {}, opts);
    const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const tag = pulumi.interpolate`${args.region}-docker.pkg.dev/${args.project}/${args.repository.repositoryId}/vibelog-app:pulumi-${args.environment}`;
    this.image = new dockerBuild.Image(`${name}-build`, {
      context: { location: repositoryRoot },
      dockerfile: { location: fileURLToPath(new URL('../../../packages/app/Dockerfile', import.meta.url)) },
      platforms: [dockerBuild.Platform.Linux_amd64],
      tags: [tag],
      push: true,
      buildOnPreview: false,
    }, {
      parent: this,
      dependsOn: [args.repository],
      retainOnDelete: true,
    });
    this.reference = this.image.ref;
    this.registerOutputs({ reference: this.reference });
  }
}
