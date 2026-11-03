import { parentDir, shellQuote } from './shell';

/**
 * Shell script builders for the git work done inside a sandbox. They are pure
 * so they can be exercised against real local repositories in tests.
 */

const PARTIAL_CLONE_FILTER = '--filter=blob:limit=50m';

export function bakeScript({
  repo,
  mirror,
  checkout,
  install,
}: {
  repo: string;
  mirror: string;
  checkout: string;
  install: string | null;
}) {
  const installStep = install ? [`cd ${shellQuote(checkout)} && ${install}`] : [];
  return [
    'set -e',
    `mkdir -p ${shellQuote(parentDir(mirror))}`,
    `git clone --quiet --bare ${PARTIAL_CLONE_FILTER} https://github.com/${repo}.git ${shellQuote(mirror)}`,
    `git -C ${shellQuote(mirror)} config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'`,
    `git -C ${shellQuote(mirror)} worktree add --quiet --detach ${shellQuote(checkout)} HEAD`,
    ...installStep,
  ].join('\n');
}

/**
 * Points the checkout at `branch`, fetching it first. A branch that does not
 * exist on the remote is created from the remote's default branch. With no
 * branch, the checkout is detached at the default branch's tip.
 */
export function switchScript({
  mirror,
  dir,
  branch,
}: {
  mirror: string;
  dir: string;
  branch: string | null;
}) {
  const mirrorGit = `git -C ${shellQuote(mirror)}`;
  const dirGit = `git -C ${shellQuote(dir)}`;
  const lines = [
    'set -e',
    `base=$(${mirrorGit} fetch --quiet origin HEAD && ${mirrorGit} rev-parse FETCH_HEAD)`,
  ];
  if (!branch) {
    lines.push(`${dirGit} checkout --quiet --detach "$base"`);
    return lines.join('\n');
  }
  lines.push(
    `branch=${shellQuote(branch)}`,
    `if ${mirrorGit} fetch --quiet origin "refs/heads/$branch:refs/remotes/origin/$branch"; then start="origin/$branch"; else start="$base"; fi`,
    `${dirGit} checkout --quiet -B "$branch" "$start"`
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
