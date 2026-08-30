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
      event('update', 'urn::gcp:cloudrunv2/service:Service::worker', { name: 'vibelog-worker-dev', ingress: 'INGRESS_TRAFFIC_ALL' }),
      event('create', 'urn::cloudflare:index/r2CustomDomain:R2CustomDomain::public'),
    ].join('\n');
    expect(findUnsafeChanges(preview)).toHaveLength(4);
  });
});
