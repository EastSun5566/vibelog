import { fileURLToPath } from 'node:url';
import * as dockerBuild from '@pulumi/docker-build';
import * as pulumi from '@pulumi/pulumi';

export interface ApplicationImageArgs {
  repository: pulumi.Input<string>;
  environment: string;
  /** Reuse and store layers in the GitHub Actions cache (needs the Actions runtime credentials). */
  githubActionsCache?: boolean;
}

/** CI and deploys share one scope, so a deploy reuses layers its pull request already built. */
const CACHE_SCOPE = 'app-image';

/** Builds and pushes the immutable application image consumed by both Cloud Run services. */
export class ApplicationImage extends pulumi.ComponentResource {
  readonly image: dockerBuild.Image;
  readonly reference: pulumi.Output<string>;

  constructor(name: string, args: ApplicationImageArgs, opts?: pulumi.ComponentResourceOptions) {
    super('vibelog:infra:ApplicationImage', name, {}, opts);
    const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const tag = pulumi.interpolate`${args.repository}:pulumi-${args.environment}`;
    this.image = new dockerBuild.Image(
      `${name}-build`,
      {
        context: { location: repositoryRoot },
        dockerfile: {
          location: fileURLToPath(new URL('../../../packages/app/Dockerfile', import.meta.url)),
        },
        platforms: [dockerBuild.Platform.Linux_amd64],
        tags: [tag],
        push: true,
        buildOnPreview: false,
        ...(args.githubActionsCache
          ? {
              cacheFrom: [{ gha: { scope: CACHE_SCOPE } }],
              // A cache that cannot be written must never fail a deploy.
              cacheTo: [
                { gha: { scope: CACHE_SCOPE, mode: dockerBuild.CacheMode.Max, ignoreError: true } },
              ],
            }
          : {}),
      },
      {
        parent: this,
        retainOnDelete: true,
      },
    );
    this.reference = this.image.ref;
    this.registerOutputs({ reference: this.reference });
  }
}
