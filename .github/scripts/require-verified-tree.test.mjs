import { expect, test } from 'vitest';
import { findVerifiedRun } from './require-verified-tree.mjs';

const trees = { main1: 'tree-a', pr1: 'tree-a', pr2: 'tree-b', pr3: 'tree-a' };
/** @param {string} sha */
const treeOf = async (sha) => trees[/** @type {keyof typeof trees} */ (sha)] ?? 'unknown';
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
  expect(
    await findVerifiedRun({ deploySha: 'main1', deployTree: 'tree-a', runs: [exact], treeOf }),
  ).toEqual({ run: exact, reason: 'exact-sha' });
});

test('accepts a successful pull request CI on an identical tree', async () => {
  const pr = run({ id: 8, head_sha: 'pr1' });
  expect(
    await findVerifiedRun({ deploySha: 'main1', deployTree: 'tree-a', runs: [pr], treeOf }),
  ).toEqual({ run: pr, reason: 'same-tree' });
});

test('rejects pull request CI on a different tree', async () => {
  expect(
    await findVerifiedRun({
      deploySha: 'main1',
      deployTree: 'tree-a',
      runs: [run({ head_sha: 'pr2' })],
      treeOf,
    }),
  ).toBeNull();
});

test('ignores runs that are unfinished, unsuccessful or not from pull requests', async () => {
  expect(
    await findVerifiedRun({
      deploySha: 'main1',
      deployTree: 'tree-a',
      runs: [
        run({ head_sha: 'main1', event: 'push', status: 'in_progress', conclusion: null }),
        run({ head_sha: 'pr1', conclusion: 'failure' }),
        run({ head_sha: 'pr3', status: 'queued', conclusion: null }),
        run({ head_sha: 'pr1', event: 'push' }),
      ],
      treeOf,
    }),
  ).toBeNull();
});
