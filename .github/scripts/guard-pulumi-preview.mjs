import { readFileSync } from 'node:fs';

const statefulType = /(r2Bucket:R2Bucket|artifactregistry\/repository:Repository|secretmanager\/secret:Secret|neon:index\/project:Project|dynamic\/resend:Domain)(?:::|$)/i;
const publicR2Type = /r2(Custom|Managed)Domain/i;
const foundationRootType = /::(?:pulumi:pulumi:Stack|pulumi:providers:(?:gcp|cloudflare|neon))::/i;
const productionFoundationType = /::vibelog:infra:ProductionFoundation(?:\$(?:gcp:artifactregistry\/repository:Repository|cloudflare:index\/r2Bucket:R2Bucket|neon:index\/project:Project))?::/i;
const emailFoundationType = /::vibelog:infra:EmailFoundation(?:\$(?:cloudflare:index\/(?:dnsRecord:DnsRecord|emailRoutingAddress:EmailRoutingAddress|emailRoutingDns:EmailRoutingDns)|pulumi-nodejs:dynamic\/resend:(?:Domain|DomainVerification|ApiKey)))?::/i;

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) { return typeof value === 'object' && value !== null ? value : {}; }

/** @param {string} contents @returns {Record<string, unknown>[]} */
function previewMetadata(contents) {
  const trimmed = contents.trim();
  if (!trimmed) return [];
  try {
    const preview = record(JSON.parse(trimmed));
    if (Array.isArray(preview.steps)) {
      return preview.steps.map((value) => {
        const step = record(value);
        return {
          op: step.op,
          urn: step.urn,
          new: step.newState,
          old: step.oldState,
        };
      });
    }
    return [record(record(preview.resourcePreEvent).metadata)];
  } catch {
    return trimmed.split(/\r?\n/).filter(Boolean).map((line) =>
      record(record(record(JSON.parse(line)).resourcePreEvent).metadata));
  }
}

/** @param {string} urn */
function isFoundationResource(urn) {
  return foundationRootType.test(urn)
    || productionFoundationType.test(urn)
    || emailFoundationType.test(urn);
}

/** @param {string} operation @param {string} urn */
function isApplicationMigrationReplacement(operation, urn) {
  return operation === 'delete-replaced'
    && /::vibelog:infra:DatabaseMigration\$command:local:Command::database-migration-run$/.test(urn);
}

/** @param {string} lines @param {'application' | 'foundation'} [profile] @returns {string[]} */
export function findUnsafeChanges(lines, profile = 'application') {
  if (profile !== 'application' && profile !== 'foundation') throw new Error(`Unknown Pulumi preview profile: ${profile}`);
  /** @type {string[]} */
  const failures = [];
  for (const metadata of previewMetadata(lines)) {
    if (Object.keys(metadata).length === 0) continue;
    const operation = String(metadata.op ?? '');
    const urn = String(metadata.urn ?? metadata.type ?? 'unknown resource');
    const next = record(metadata.new);
    const inputs = Object.hasOwn(next, 'inputs') ? record(next.inputs) : next;

    const allowedMigrationReplacement = profile === 'application'
      && isApplicationMigrationReplacement(operation, urn);
    if (operation.includes('delete') && !allowedMigrationReplacement) failures.push(`${operation}: ${urn}`);
    if (operation.includes('replace') && statefulType.test(urn)) failures.push(`${operation} of stateful resource: ${urn}`);
    if (publicR2Type.test(urn)) failures.push(`public R2 exposure: ${urn}`);
    if (profile === 'foundation' && !isFoundationResource(urn)) failures.push(`resource outside foundation profile: ${urn}`);

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
