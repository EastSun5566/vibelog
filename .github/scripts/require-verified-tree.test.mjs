import { expect, test } from 'vitest';
import { findVerifiedRun } from './require-verified-tree.mjs';

const trees = { main1: 'tree-a', pr1: 'tree-a', pr2: 'tree-b', pr3: 'tree-a' };
/** @param {string} sha */
const treeOf = async (sha) => trees[/** @type {keyof typeof trees} */ (sha)] ?? 'unknown';
/** Heads that already contain the commit main had before the deploy commit. */
const upToDate = new Set(['pr1', 'pr2', 'pr3']);
/** @param {string} sha */
const containsDeployParent = async (sha) => upToDate.has(sha);
const gate = {
  deploySha: 'main1',
  deployTree: 'tree-a',
  treeOf,
  containsDeployParent,
};
/** @param {Partial<import('./require-verified-tree.mjs').CiRun>} run */
const run = (run) => ({
  id: 1,
  head_sha: 'pr1',
  event: 'pull_request',
  status: 'completed',
  conclusion: 'success',
  ...run,
});

test('accepts a successful push CI for the exact main commit', async () => {
  const exact = run({ id: 7, head_sha: 'main1', event: 'push' });
  expect(await findVerifiedRun({ ...gate, runs: [exact] })).toEqual({
    run: exact,
    reason: 'exact-sha',
  });
});

test('accepts a successful pull request CI on an identical tree', async () => {
  const pr = run({ id: 8, head_sha: 'pr1' });
  expect(await findVerifiedRun({ ...gate, runs: [pr] })).toEqual({
    run: pr,
    reason: 'same-tree',
  });
});

test('rejects pull request CI on a different tree', async () => {
  expect(await findVerifiedRun({ ...gate, runs: [run({ head_sha: 'pr2' })] })).toBeNull();
});

test('ignores runs that are unfinished, unsuccessful or not from pull requests', async () => {
  expect(
    await findVerifiedRun({
      ...gate,
      runs: [
        run({
          head_sha: 'main1',
          event: 'push',
          status: 'in_progress',
          conclusion: null,
        }),
        run({ head_sha: 'pr1', conclusion: 'failure' }),
        run({ head_sha: 'pr3', status: 'queued', conclusion: null }),
        run({ head_sha: 'pr1', event: 'push' }),
      ],
    }),
  ).toBeNull();
});

test('rejects an identical tree when the head was tested against an older base', async () => {
  // e.g. main changed and then reverted that change after the pull request's CI ran.
  expect(
    await findVerifiedRun({
      ...gate,
      runs: [run({ head_sha: 'pr1' })],
      containsDeployParent: async () => false,
    }),
  ).toBeNull();
});
