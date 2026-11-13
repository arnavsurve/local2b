import { parseRepo } from './repo';

/** The current branch of a local checkout. `ahead` is null when `origin/<name>` does not exist locally. */
export type LocalBranch = { name: string; ahead: number | null };

/** What l2b reads from the git checkout in cwd. */
export type LocalCheckout = {
  /** The `origin` remote URL, or null without one. */
  origin: string | null;
  /** null on a detached HEAD. */
  branch: LocalBranch | null;
  /** The branch `origin/HEAD` points at, or null when unknown. */
  defaultBranch: string | null;
};

async function git({ cwd, args }: { cwd: string; args: string[] }) {
  const proc = Bun.spawn(['git', ...args], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
  const out = await new Response(proc.stdout).text();
  return (await proc.exited) === 0 ? out.trim() : null;
}

async function readBranch({ cwd }: { cwd: string }): Promise<LocalBranch | null> {
  const name = await git({ cwd, args: ['symbolic-ref', '--short', '-q', 'HEAD'] });
  if (!name) return null;
  const remoteRef = `refs/remotes/origin/${name}`;
  if ((await git({ cwd, args: ['rev-parse', '--verify', '-q', remoteRef] })) === null) return { name, ahead: null };
  const count = await git({ cwd, args: ['rev-list', '--count', `${remoteRef}..HEAD`] });
  return { name, ahead: count === null ? 0 : Number(count) };
}

/** The git checkout `cwd` is in, or null when it is not in one. Reads local refs only; nothing is fetched. */
export async function readCheckout({ cwd }: { cwd: string }): Promise<LocalCheckout | null> {
  if ((await git({ cwd, args: ['rev-parse', '--is-inside-work-tree'] })) !== 'true') return null;
  const head = await git({ cwd, args: ['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD'] });
  return {
    origin: await git({ cwd, args: ['remote', 'get-url', 'origin'] }),
    branch: await readBranch({ cwd }),
    defaultBranch: head?.startsWith('origin/') ? head.slice('origin/'.length) : null,
  };
}

/** `git@host:path` is ssh shorthand; everything else git accepts as a remote here is a URL. */
function remoteAsUrl(remote: string) {
  const scp = /^([^@/:]+@)?([^/:]+):(?!\/\/)(.+)$/.exec(remote);
  const candidate = scp ? `ssh://${scp[1] ?? ''}${scp[2]}/${scp[3]}` : remote;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

/** `owner/name` for a remote on the git host at `baseUrl`, or null when the remote is elsewhere. */
export function repoFromRemote({ remote, baseUrl }: { remote: string; baseUrl: string }): string | null {
  const url = remoteAsUrl(remote);
  const base = remoteAsUrl(baseUrl);
  if (!url || !base || url.hostname !== base.hostname) return null;
  const prefix = `${base.pathname.replace(/\/+$/, '')}/`;
  if (!url.pathname.startsWith(prefix)) return null;
  const repo = url.pathname.slice(prefix.length).replace(/\/+$/, '').replace(/\.git$/, '');
  try {
    parseRepo(repo);
    return repo;
  } catch {
    return null;
  }
}

/** One line about how the box's checkout will differ from the local branch, or null when it matches. */
export function branchWarning({ branch }: { branch: LocalBranch | null }) {
  if (!branch) return "HEAD is detached, so the box uses the remote's default branch; pass --branch to pick one";
  if (branch.ahead === null) {
    return `branch ${branch.name} is not on origin, so the box creates it from the default branch; push it first (git push -u origin ${branch.name})`;
  }
  if (branch.ahead === 0) return null;
  const commits = branch.ahead === 1 ? 'commit' : 'commits';
  return `branch ${branch.name} has ${branch.ahead} unpushed ${commits}; the box checks out origin/${branch.name}`;
}
