import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cloudflare from '@pulumi/cloudflare';
import * as pulumi from '@pulumi/pulumi';

export interface CloudflareDeliveryArgs {
  accountId: pulumi.Input<string>; zoneId: pulumi.Input<string>; rootDomain: pulumi.Input<string>;
  originUrl: pulumi.Input<string>;
  edgeSharedSecret: pulumi.Input<string>; supportAddress: pulumi.Input<string>; forwardingDestination: pulumi.Input<string>;
  forwardingAddress: cloudflare.EmailRoutingAddress; provider: cloudflare.Provider; bundlePath?: string;
}
export class CloudflareDelivery extends pulumi.ComponentResource {
  readonly script: cloudflare.WorkersScript;
  readonly routes: cloudflare.WorkersRoute[];
  constructor(name: string, args: CloudflareDeliveryArgs, opts?: pulumi.ComponentResourceOptions) {
    super('vibelog:infra:CloudflareDelivery', name, {}, opts);
    const resourceOptions = { parent: this, provider: args.provider };
    const defaultBundlePath = fileURLToPath(new URL('../../../packages/edge/dist/index.js', import.meta.url));
    const content = readFileSync(resolve(args.bundlePath ?? defaultBundlePath), 'utf8');
    this.script = new cloudflare.WorkersScript(`${name}-edge`, {
      accountId: args.accountId, scriptName: `vibelog-${pulumi.getStack()}-edge`, compatibilityDate: '2026-08-29',
      content, mainModule: 'index.js', bindings: [
        { name: 'ORIGIN_URL', type: 'plain_text', text: args.originUrl },
        { name: 'EDGE_SHARED_SECRET', type: 'secret_text', text: pulumi.secret(args.edgeSharedSecret) },
      ],
    }, resourceOptions);
    new cloudflare.DnsRecord(`${name}-wildcard-dns`, { zoneId: args.zoneId, name: pulumi.interpolate`*.${args.rootDomain}`, type: 'A', content: '192.0.2.1', ttl: 1, proxied: true }, resourceOptions);
    const wildcardRoute = new cloudflare.WorkersRoute(`${name}-wildcard-route`, { zoneId: args.zoneId, pattern: pulumi.interpolate`*.${args.rootDomain}/*`, script: this.script.scriptName }, resourceOptions);
    new cloudflare.DnsRecord(`${name}-apex-dns`, { zoneId: args.zoneId, name: args.rootDomain, type: 'A', content: '192.0.2.1', ttl: 1, proxied: true }, resourceOptions);
    const apexRoute = new cloudflare.WorkersRoute(`${name}-apex-route`, { zoneId: args.zoneId, pattern: pulumi.interpolate`${args.rootDomain}/*`, script: this.script.scriptName }, resourceOptions);
    new cloudflare.EmailRoutingRule(`${name}-support-forwarding`, {
      zoneId: args.zoneId,
      actions: [{ type: 'forward', values: [args.forwardingDestination] }],
      matchers: [{ type: 'literal', field: 'to', value: args.supportAddress }],
      enabled: true,
      name: 'Forward VibeLog support email',
      priority: 0,
      source: 'api',
    }, { ...resourceOptions, dependsOn: args.forwardingAddress });
    this.routes = [apexRoute, wildcardRoute];
    this.registerOutputs({ scriptName: this.script.scriptName, routePatterns: this.routes.map((route) => route.pattern) });
  }
}
