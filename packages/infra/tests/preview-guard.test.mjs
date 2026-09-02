import { describe, expect, it } from 'vitest';
import { findUnsafeChanges } from '../../../.github/scripts/guard-pulumi-preview.mjs';

/** @param {string} op @param {string} urn @param {Record<string, unknown>} inputs */
function event(op, urn, inputs = {}) {
  return JSON.stringify({ resourcePreEvent: { metadata: { op, urn, new: { inputs } } } });
}

describe('Pulumi preview safety gate', () => {
  it('allows the public web service and private worker', () => {
    const preview = [
      event('update', 'urn::gcp:cloudrunv2/service:Service::web', { name: 'vibelog-web-dev', ingress: 'INGRESS_TRAFFIC_ALL' }),
      event('update', 'urn::gcp:cloudrunv2/service:Service::worker', { name: 'vibelog-worker-dev', ingress: 'INGRESS_TRAFFIC_INTERNAL_ONLY' }),
    ].join('\n');
    expect(findUnsafeChanges(preview)).toEqual([]);
  });

  it('rejects deletes, stateful replacement, a public worker, and public R2 domains', () => {
    const preview = [
      event('delete', 'urn::gcp:cloudrunv2/service:Service::old'),
      event('replace', 'urn::cloudflare:index/r2Bucket:R2Bucket::artifacts'),
      event('replace', 'urn::neon:index/project:Project::database'),
      event('update', 'urn::gcp:cloudrunv2/service:Service::worker', { name: 'vibelog-worker-dev', ingress: 'INGRESS_TRAFFIC_ALL' }),
      event('create', 'urn::cloudflare:index/r2CustomDomain:R2CustomDomain::public'),
    ].join('\n');
    expect(findUnsafeChanges(preview)).toHaveLength(5);
  });

  it('allows only the protected foundation graph in foundation mode', () => {
    const preview = [
      event('create', 'urn:pulumi:prod::vibelog::pulumi:providers:gcp::gcp'),
      event('create', 'urn:pulumi:prod::vibelog::pulumi:providers:cloudflare::cloudflare-r2'),
      event('create', 'urn:pulumi:prod::vibelog::pulumi:providers:cloudflare::cloudflare-delivery'),
      event('create', 'urn:pulumi:prod::vibelog::pulumi:providers:neon::neon'),
      event('create', 'urn:pulumi:prod::vibelog::vibelog:infra:ProductionFoundation::foundation'),
      event('create', 'urn:pulumi:prod::vibelog::vibelog:infra:ProductionFoundation$gcp:artifactregistry/repository:Repository::foundation-images'),
      event('create', 'urn:pulumi:prod::vibelog::vibelog:infra:ProductionFoundation$cloudflare:index/r2Bucket:R2Bucket::foundation-artifacts'),
      event('create', 'urn:pulumi:prod::vibelog::vibelog:infra:ProductionFoundation$neon:index/project:Project::foundation-database'),
      event('create', 'urn:pulumi:prod::vibelog::vibelog:infra:EmailFoundation::email'),
      event('create', 'urn:pulumi:prod::vibelog::vibelog:infra:EmailFoundation$pulumi-nodejs:dynamic/resend:Domain::email-domain'),
      event('create', 'urn:pulumi:prod::vibelog::vibelog:infra:EmailFoundation$cloudflare:index/dnsRecord:DnsRecord::email-resend-dkim'),
      event('create', 'urn:pulumi:prod::vibelog::vibelog:infra:EmailFoundation$pulumi-nodejs:dynamic/resend:DomainVerification::email-domain-verification'),
      event('create', 'urn:pulumi:prod::vibelog::vibelog:infra:EmailFoundation$pulumi-nodejs:dynamic/resend:ApiKey::email-runtime-key'),
      event('create', 'urn:pulumi:prod::vibelog::vibelog:infra:EmailFoundation$cloudflare:index/emailRoutingAddress:EmailRoutingAddress::email-forwarding-destination'),
      event('create', 'urn:pulumi:prod::vibelog::vibelog:infra:EmailFoundation$cloudflare:index/emailRoutingDns:EmailRoutingDns::email-routing-dns'),
    ].join('\n');
    expect(findUnsafeChanges(preview, 'foundation')).toEqual([]);
  });

  it('accepts the formatted JSON document emitted by current Pulumi CLI', () => {
    const preview = JSON.stringify({
      config: { 'vibelog:resendManagementApiKey': '[secret]' },
      steps: [
        {
          op: 'create',
          urn: 'urn:pulumi:prod::vibelog::vibelog:infra:EmailFoundation$cloudflare:index/dnsRecord:DnsRecord::email-resend-dkim',
          newState: { inputs: { proxied: false } },
        },
      ],
      changeSummary: { create: 1 },
    }, null, 2);
    expect(findUnsafeChanges(preview, 'foundation')).toEqual([]);
  });

  it('rejects replacement of the Resend sending domain', () => {
    const preview = event('replace', 'urn:pulumi:prod::vibelog::vibelog:infra:EmailFoundation$pulumi-nodejs:dynamic/resend:Domain::email-domain');
    expect(findUnsafeChanges(preview, 'foundation')).toEqual([
      'replace of stateful resource: urn:pulumi:prod::vibelog::vibelog:infra:EmailFoundation$pulumi-nodejs:dynamic/resend:Domain::email-domain',
    ]);
  });

  it('rejects application and public resources in foundation mode', () => {
    const preview = [
      event('create', 'urn:pulumi:prod::vibelog::vibelog:infra:GcpContainerRuntime$gcp:cloudrunv2/service:Service::web'),
      event('create', 'urn:pulumi:prod::vibelog::cloudflare:index/r2ManagedDomain:R2ManagedDomain::public'),
    ].join('\n');
    expect(findUnsafeChanges(preview, 'foundation')).toHaveLength(3);
  });

  it('rejects Cloudflare delivery resources outside EmailFoundation in foundation mode', () => {
    const preview = [
      event('create', 'urn:pulumi:prod::vibelog::cloudflare:index/dnsRecord:DnsRecord::rogue-dns'),
      event('create', 'urn:pulumi:prod::vibelog::cloudflare:index/emailRoutingRule:EmailRoutingRule::rogue-forwarding'),
    ].join('\n');
    expect(findUnsafeChanges(preview, 'foundation')).toEqual([
      'resource outside foundation profile: urn:pulumi:prod::vibelog::cloudflare:index/dnsRecord:DnsRecord::rogue-dns',
      'resource outside foundation profile: urn:pulumi:prod::vibelog::cloudflare:index/emailRoutingRule:EmailRoutingRule::rogue-forwarding',
    ]);
  });
});
