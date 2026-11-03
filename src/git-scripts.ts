import { parentDir, shellQuote } from './shell';

/**
 * Shell script builders for the git work done inside a sandbox. They are pure
 * so they can be exercised against real local repositories in tests.
 */

const PARTIAL_CLONE_FILTER = '--filter=blob:limit=50m';

export function bakeScript({
  repo,
  mirror,
  seed,
  install,
}: {
  repo: string;
  mirror: string;
  seed: string;
  install: string | null;
}) {
  const installStep = install ? [`cd ${shellQuote(seed)} && ${install}`] : [];
  return [
    'set -e',
    `mkdir -p ${shellQuote(parentDir(mirror))}`,
    `git clone --quiet --bare ${PARTIAL_CLONE_FILTER} https://github.com/${repo}.git ${shellQuote(mirror)}`,
    `git -C ${shellQuote(mirror)} config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'`,
    `git -C ${shellQuote(mirror)} worktree add --quiet --detach ${shellQuote(seed)} HEAD`,
    ...installStep,
  ].join('\n');
}

/**
 * Checks out `branch` into a new worktree of the mirror. A branch that does
 * not exist on the remote is created from the remote's default branch.
 * With no branch, the worktree is a detached checkout of the default branch.
 */
export function worktreeScript({
  mirror,
  dir,
  branch,
}: {
  mirror: string;
  dir: string;
  branch: string | null;
}) {
  const git = `git -C ${shellQuote(mirror)}`;
  const lines = [
    'set -e',
    `mkdir -p ${shellQuote(parentDir(dir))}`,
    `base=$(${git} fetch --quiet origin HEAD && ${git} rev-parse FETCH_HEAD)`,
  ];
  if (!branch) {
    lines.push(`${git} worktree add --quiet --detach ${shellQuote(dir)} "$base"`);
    return lines.join('\n');
  }
  lines.push(
    `branch=${shellQuote(branch)}`,
    `if ${git} fetch --quiet origin "refs/heads/$branch:refs/remotes/origin/$branch"; then start="origin/$branch"; else start="$base"; fi`,
    `${git} worktree add --quiet -B "$branch" ${shellQuote(dir)} "$start"`
  );
  return lines.join('\n');
}

export function shallowCloneCommand({
  repo,
  dir,
  branch,
}: {
  repo: string;
  dir: string;
  branch: string | null;
}) {
  const branchFlag = branch ? `-b ${shellQuote(branch)}` : '';
  return `git clone --quiet --depth=1 ${PARTIAL_CLONE_FILTER} ${branchFlag} https://github.com/${repo}.git ${shellQuote(dir)}`;
}

export function fullCloneCommand({
  repo,
  dir,
  branch,
}: {
  repo: string;
  dir: string;
  branch: string | null;
}) {
  const branchFlag = branch ? `-b ${shellQuote(branch)}` : '';
  return `git clone --quiet ${branchFlag} https://github.com/${repo}.git ${shellQuote(dir)}`;
}
