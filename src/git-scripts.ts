import { parentDir, shellQuote } from './shell';

/**
 * Shell script builders for the git work done inside a sandbox. They are pure
 * so they can be exercised against real local repositories in tests.
 */

/** Conservative shape of a git `--filter` spec (`blob:limit=50m`, `combine:blob:none+tree:0`). */
export const FILTER_PATTERN = /^[A-Za-z0-9:=_.,+-]+$/;

const depthFlag = (depth: number | null) => (depth === null ? null : `--depth=${depth}`);

const filterFlag = (filter: string | null) => {
  if (filter === null) return null;
  const flag = `--filter=${filter}`;
  return FILTER_PATTERN.test(filter) ? flag : shellQuote(flag);
};

const joinFlags = (parts: (string | null)[]) => parts.filter((part) => part !== null).join(' ');

/**
 * With a `mirror`, clones a bare mirror and adds a detached worktree at
 * `checkout`. Without one, makes an ordinary clone at `checkout`.
 */
export function bakeScript({
  remote,
  mirror,
  checkout,
  install,
  warm,
  branch,
  depth,
  filter,
}: {
  remote: string;
  mirror: string | null;
  checkout: string;
  install: string | null;
  warm: string | null;
  branch: string | null;
  depth: number | null;
  filter: string | null;
}) {
  const branchFlag = branch ? `--branch ${shellQuote(branch)}` : '';
  const prepare = [install, warm].filter((cmd) => cmd !== null);
  const prepareStep = prepare.length
    ? [`cd ${shellQuote(checkout)} && ${prepare.join(' && ')}`]
    : [];
  if (mirror === null) {
    return [
      'set -e',
      `mkdir -p ${shellQuote(parentDir(checkout))}`,
      joinFlags([
        'git clone --quiet',
        depthFlag(depth),
        filterFlag(filter),
        branchFlag,
        shellQuote(remote),
        shellQuote(checkout),
      ]),
      ...prepareStep,
    ].join('\n');
  }
  return [
    'set -e',
    `mkdir -p ${shellQuote(parentDir(mirror))}`,
    joinFlags([
      'git clone --quiet --bare',
      depthFlag(depth),
      filterFlag(filter),
      branchFlag,
      shellQuote(remote),
      shellQuote(mirror),
    ]),
    `git -C ${shellQuote(mirror)} config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'`,
    `git -C ${shellQuote(mirror)} worktree add --quiet --detach ${shellQuote(checkout)} HEAD`,
    ...prepareStep,
  ].join('\n');
}

/**
 * Points the checkout at `branch`, fetching it first. A branch that does not
 * exist on the remote is created from the remote's default branch. With no
 * branch, the checkout is detached at the default branch's tip. Fetches go
 * through `mirror` when there is one, else into the checkout itself.
 */
export function switchScript({
  mirror,
  dir,
  branch,
  depth,
}: {
  mirror: string | null;
  dir: string;
  branch: string | null;
  depth: number | null;
}) {
  const fetchGit = `git -C ${shellQuote(mirror ?? dir)}`;
  const dirGit = `git -C ${shellQuote(dir)}`;
  const fetch = joinFlags([`${fetchGit} fetch --quiet`, depthFlag(depth), 'origin']);
  const lines = [
    'set -e',
    `base=$(${fetch} HEAD && ${fetchGit} rev-parse FETCH_HEAD)`,
  ];
  if (!branch) {
    lines.push(`${dirGit} checkout --quiet --detach "$base"`);
    return lines.join('\n');
  }
  lines.push(
    `branch=${shellQuote(branch)}`,
    `if ${fetch} "refs/heads/$branch:refs/remotes/origin/$branch"; then start="origin/$branch"; else start="$base"; fi`,
    `${dirGit} checkout --quiet -B "$branch" "$start"`
  );
  return lines.join('\n');
}

/** An ordinary clone, used when no baked snapshot exists. */
export function cloneCommand({
  remote,
  dir,
  branch,
  depth,
  filter,
}: {
  remote: string;
  dir: string;
  branch: string | null;
  depth: number | null;
  filter: string | null;
}) {
  return joinFlags([
    'git clone --quiet',
    depthFlag(depth),
    filterFlag(filter),
    branch ? `-b ${shellQuote(branch)}` : null,
    shellQuote(remote),
    shellQuote(dir),
  ]);
}
