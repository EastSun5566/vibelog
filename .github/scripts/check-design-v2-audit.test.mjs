import { expect, test } from 'vitest';
import { checkDesignV2Audit } from './check-design-v2-audit.mjs';

const audit = (v1Revisions, v1PreviewSessions) => JSON.stringify({ event: 'design_v2_migration', mode: 'audit', v1Revisions, v1PreviewSessions });

test('requires the expected V1 revision count before conversion', () => {
  expect(checkDesignV2Audit(audit(3, 2), '3')).toEqual({ v1Revisions: 3, v1PreviewSessions: 2 });
  expect(() => checkDesignV2Audit(audit(3, 2), '2')).toThrow(/Expected 2/);
  expect(() => checkDesignV2Audit(audit(3, 2), '-1')).toThrow(/non-negative/);
});

test('blocks deployment while any V1 revisions or previews remain', () => {
  expect(checkDesignV2Audit(audit(0, 0), 'zero')).toEqual({ v1Revisions: 0, v1PreviewSessions: 0 });
  expect(() => checkDesignV2Audit(audit(0, 1), 'zero')).toThrow(/blocked/);
  expect(() => checkDesignV2Audit(audit(1, 0), 'zero')).toThrow(/blocked/);
  expect(() => checkDesignV2Audit('other log', 'zero')).toThrow(/missing/);
  expect(() => checkDesignV2Audit(audit(-1, 0), 'zero')).toThrow(/Invalid/);
});
