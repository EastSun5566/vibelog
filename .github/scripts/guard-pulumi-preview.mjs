import { readFileSync } from 'node:fs';

const statefulType = /(r2Bucket:R2Bucket|artifactregistry\/repository:Repository|secretmanager\/secret:Secret)(?:::|$)/i;
const publicR2Type = /r2(Custom|Managed)Domain/i;
const foundationType = /(pulumi:pulumi:Stack|pulumi:providers:(gcp|cloudflare)|vibelog:infra:ProductionFoundation|gcp:artifactregistry\/repository:Repository|cloudflare:index\/r2Bucket:R2Bucket)(?:\$|::|$)/i;

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) { return typeof value === 'object' && value !== null ? value : {}; }

/** @param {string} lines @param {'application' | 'foundation'} [profile] @returns {string[]} */
export function findUnsafeChanges(lines, profile = 'application') {
  if (profile !== 'application' && profile !== 'foundation') throw new Error(`Unknown Pulumi preview profile: ${profile}`);
  /** @type {string[]} */
  const failures = [];
  for (const line of lines.split(/\r?\n/).filter(Boolean)) {
    const event = record(JSON.parse(line));
    const metadata = record(record(event.resourcePreEvent).metadata);
    if (Object.keys(metadata).length === 0) continue;
    const operation = String(metadata.op ?? '');
    const urn = String(metadata.urn ?? metadata.type ?? 'unknown resource');
    const next = record(metadata.new);
    const inputs = Object.hasOwn(next, 'inputs') ? record(next.inputs) : next;

    if (operation.includes('delete')) failures.push(`${operation}: ${urn}`);
    if (operation.includes('replace') && statefulType.test(urn)) failures.push(`${operation} of stateful resource: ${urn}`);
    if (publicR2Type.test(urn)) failures.push(`public R2 exposure: ${urn}`);
    if (profile === 'foundation' && !foundationType.test(urn)) failures.push(`resource outside foundation profile: ${urn}`);

    const isWorkerService = /cloudrunv2\/service:Service/i.test(urn)
      && String(inputs.name ?? '').includes('worker');
    if (isWorkerService && inputs.ingress === 'INGRESS_TRAFFIC_ALL') failures.push(`public worker ingress: ${urn}`);

    const isWorkerIam = /cloudrunv2\/serviceIam/i.test(urn)
      && String(inputs.name ?? '').includes('worker');
    if (isWorkerIam && inputs.member === 'allUsers') failures.push(`public worker IAM: ${urn}`);
  }
  return [...new Set(failures)];
}

const previewPath = process.argv[2];
if (previewPath) {
  const profile = process.argv[3] ?? 'application';
  const failures = findUnsafeChanges(readFileSync(previewPath, 'utf8'), profile);
  if (failures.length) {
    console.error(`Unsafe Pulumi preview:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
    process.exitCode = 1;
  }
}
