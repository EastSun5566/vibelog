import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as cloudflare from '@pulumi/cloudflare';
import * as pulumi from '@pulumi/pulumi';

export interface CloudflareDeliveryArgs {
  accountId: pulumi.Input<string>; zoneId: pulumi.Input<string>; rootDomain: pulumi.Input<string>;
  bucketName: pulumi.Input<string>; location: pulumi.Input<string>; originUrl: pulumi.Input<string>;
  edgeSharedSecret: pulumi.Input<string>; provider: cloudflare.Provider; bundlePath?: string;
}
export class CloudflareDelivery extends pulumi.ComponentResource {
  readonly bucket: cloudflare.R2Bucket;
  readonly script: cloudflare.WorkersScript;
  readonly routes: cloudflare.WorkersRoute[];
  constructor(name: string, args: CloudflareDeliveryArgs, opts?: pulumi.ComponentResourceOptions) {
    super('vibelog:infra:CloudflareDelivery', name, {}, opts);
    const resourceOptions = { parent: this, provider: args.provider };
    this.bucket = new cloudflare.R2Bucket(`${name}-artifacts`, { accountId: args.accountId, name: args.bucketName, location: args.location, storageClass: 'Standard' }, { ...resourceOptions, protect: true });
    const content = readFileSync(resolve(args.bundlePath ?? '../edge/dist/index.js'), 'utf8');
    this.script = new cloudflare.WorkersScript(`${name}-edge`, {
      accountId: args.accountId, scriptName: `vibelog-${pulumi.getStack()}-edge`, compatibilityDate: '2026-08-29',
      content, mainModule: 'index.js', bindings: [
        { name: 'ORIGIN_URL', type: 'plain_text', text: args.originUrl },
        { name: 'EDGE_SHARED_SECRET', type: 'secret_text', text: pulumi.secret(args.edgeSharedSecret) },
      ],
    }, resourceOptions);
    new cloudflare.DnsRecord(`${name}-wildcard-dns`, { zoneId: args.zoneId, name: pulumi.interpolate`*.${args.rootDomain}`, type: 'A', content: '192.0.2.1', ttl: 1, proxied: true }, resourceOptions);
    const wildcardRoute = new cloudflare.WorkersRoute(`${name}-wildcard-route`, { zoneId: args.zoneId, pattern: pulumi.interpolate`*.${args.rootDomain}/*`, script: this.script.scriptName }, resourceOptions);
    new cloudflare.DnsRecord(`${name}-public-site-dns`, { zoneId: args.zoneId, name: pulumi.interpolate`*.app.${args.rootDomain}`, type: 'A', content: '192.0.2.1', ttl: 1, proxied: true }, resourceOptions);
    const publicSiteRoute = new cloudflare.WorkersRoute(`${name}-public-site-route`, { zoneId: args.zoneId, pattern: pulumi.interpolate`*.app.${args.rootDomain}/*`, script: this.script.scriptName }, resourceOptions);
    this.routes = [wildcardRoute, publicSiteRoute];
    this.registerOutputs({ bucketName: this.bucket.name, scriptName: this.script.scriptName, routePatterns: this.routes.map((route) => route.pattern) });
  }
}
