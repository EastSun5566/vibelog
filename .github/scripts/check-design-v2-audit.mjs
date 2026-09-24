import { readFileSync } from 'node:fs';

export function checkDesignV2Audit(contents, expected) {
  const audits = contents.split(/\r?\n/).flatMap((line) => {
    try {
      const value = JSON.parse(line);
      return value?.event === 'design_v2_migration' && value.mode === 'audit' ? [value] : [];
    } catch { return []; }
  });
  const audit = audits.at(-1);
  if (!audit) throw new Error('Design V2 audit result is missing');
  for (const name of ['v1Revisions', 'v1PreviewSessions']) {
    if (!Number.isSafeInteger(audit[name]) || audit[name] < 0) throw new Error(`Invalid ${name} in design V2 audit`);
  }
  if (expected === 'zero') {
    if (audit.v1Revisions !== 0 || audit.v1PreviewSessions !== 0) throw new Error('V1 design data remains; V2 deployment is blocked');
  } else {
    const count = Number(expected);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Expected V1 revision count must be a non-negative integer');
    if (audit.v1Revisions !== count) throw new Error(`Expected ${count} V1 revisions, found ${audit.v1Revisions}`);
  }
  return { v1Revisions: audit.v1Revisions, v1PreviewSessions: audit.v1PreviewSessions };
}

if (process.argv[1]?.endsWith('check-design-v2-audit.mjs')) {
  try {
    const result = checkDesignV2Audit(readFileSync(process.argv[2], 'utf8'), process.argv[3]);
    console.info(JSON.stringify({ event: 'design_v2_audit_verified', ...result }));
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
