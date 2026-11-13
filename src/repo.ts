import { resolveClone, type Config } from './config';
import { hostFor, remoteUrl } from './git-host';
import type { RepoSpec } from './providers/types';

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const NAME_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

/** The single place `owner/name` is validated; everything else derives from it. */
export function parseRepo(repo: string) {
  const [owner, name, ...rest] = repo.split('/');
  if (
    owner === undefined ||
    name === undefined ||
    rest.length > 0 ||
    !OWNER_PATTERN.test(owner) ||
    !NAME_PATTERN.test(name)
  ) {
    throw new Error(`bad repo "${repo}", expected owner/name`);
  }
  return { owner, name };
}

export const repoName = (repo: string) => parseRepo(repo).name;

/**
 * What a provider needs to know about `repo`: its config block merged with
 * command-line overrides, each of which is null when not given.
 */
export function repoSpecFor({
  config,
  repo,
  install,
  warm,
  baseBranch,
}: {
  config: Config;
  repo: string;
  install: string | null;
  warm: string | null;
  baseBranch: string | null;
}): RepoSpec {
  const own = config.repos[repo];
  return {
    ...parseRepo(repo),
    remoteUrl: remoteUrl({ host: hostFor({ config, repo }), repo }),
    baseBranch: baseBranch ?? own?.baseBranch ?? null,
    clone: resolveClone({ config, repo }),
    setup: own?.setup ?? [],
    install: install ?? own?.install ?? null,
    warm: warm ?? own?.warm ?? null,
    env: own?.env ?? {},
  };
}
