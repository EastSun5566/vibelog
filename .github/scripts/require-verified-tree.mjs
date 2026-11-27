/**
 * Deploy gate: the main commit must contain exactly what CI verified.
 *
 * A successful push CI for the exact SHA always qualifies. A squash merge of an up-to-date pull
 * request produces the same git tree as the pull request head, so a pull_request CI can qualify
 * too and lets the deploy start without waiting for main to run the identical CI again.
 *
 * pull_request CI tests the merge of the head with the base as it was then, not the head alone.
 * Requiring the head to already contain the deploy commit's parent makes that base an ancestor of
 * the head, so the tested merge tree equals the head tree, which equals the deployed tree.
 */

/**
 * @typedef {{ id: number, html_url?: string, head_sha: string, event: string, status: string, conclusion: string | null }} CiRun
 */

/** @param {CiRun} run */
const succeeded = (run) => run.status === 'completed' && run.conclusion === 'success';

/**
 * @param {{
 *   deploySha: string,
 *   deployTree: string,
 *   runs: CiRun[],
 *   treeOf: (sha: string) => Promise<string>,
 *   containsDeployParent: (sha: string) => Promise<boolean>,
 * }} input
 * @returns {Promise<{ run: CiRun, reason: 'exact-sha' | 'same-tree' } | null>}
 */
export async function findVerifiedRun({
  deploySha,
  deployTree,
  runs,
  treeOf,
  containsDeployParent,
}) {
  const exact = runs.find((run) => run.head_sha === deploySha && succeeded(run));
  if (exact) return { run: exact, reason: 'exact-sha' };
  for (const run of runs) {
    if (run.event !== 'pull_request' || !succeeded(run)) continue;
    if ((await treeOf(run.head_sha)) !== deployTree) continue;
    if (await containsDeployParent(run.head_sha)) return { run, reason: 'same-tree' };
  }
  return null;
}

/** @param {string} path */
async function github(path) {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GH_TOKEN ?? ''}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${path} returned ${response.status}`);
  return response.json();
}

if (process.argv[1]?.endsWith('require-verified-tree.mjs')) {
  const repository = process.env.GITHUB_REPOSITORY;
  const deploySha = process.env.DEPLOY_SHA;
  try {
    if (!repository || !deploySha)
      throw new Error('GITHUB_REPOSITORY and DEPLOY_SHA are required.');
    /** @param {string} sha */
    const commit = async (sha) =>
      /** @type {{ commit: { tree: { sha: string } }, parents: { sha: string }[] }} */ (
        await github(`repos/${repository}/commits/${sha}`)
      );
    /** @param {string} sha */
    const treeOf = async (sha) => (await commit(sha)).commit.tree.sha;
    const deployCommit = await commit(deploySha);
    const deployParent = deployCommit.parents[0]?.sha;
    /** @param {string} sha */
    const containsDeployParent = async (sha) =>
      Boolean(deployParent) &&
      ['ahead', 'identical'].includes(
        /** @type {{ status: string }} */ (
          await github(`repos/${repository}/compare/${deployParent}...${sha}`)
        ).status,
      );
    const runsFor = async (/** @type {string} */ query) =>
      /** @type {{ workflow_runs: CiRun[] }} */ (
        await github(`repos/${repository}/actions/workflows/ci.yml/runs?${query}`)
      ).workflow_runs;
    const runs = [
      ...(await runsFor(`branch=main&event=push&head_sha=${deploySha}&per_page=1`)),
      ...(await runsFor('event=pull_request&status=success&per_page=30')),
    ];
    const verified = await findVerifiedRun({
      deploySha,
      deployTree: deployCommit.commit.tree.sha,
      runs,
      treeOf,
      containsDeployParent,
    });
    if (!verified)
      throw new Error(
        `CI must finish successfully for ${deploySha} on main, or for a pull request with the identical tree, before deployment.`,
      );
    console.log(
      verified.reason === 'exact-sha'
        ? `::notice::CI passed for ${deploySha}: ${verified.run.html_url ?? verified.run.id}`
        : `::notice::${deploySha} has the same tree as ${verified.run.head_sha}, verified by ${verified.run.html_url ?? verified.run.id}`,
    );
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
