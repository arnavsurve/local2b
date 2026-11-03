import { HOME } from './shell';

export function repoName(repo: string) {
  const name = repo.split('/').pop();
  if (!name) throw new Error(`bad repo "${repo}", expected owner/name`);
  return name;
}

export const mirrorDir = (repo: string) =>
  `${HOME}/mirrors/${repoName(repo)}.git`;
export const checkoutDir = (repo: string) => `${HOME}/${repoName(repo)}`;
export const snapshotName = (repo: string) => `l2b-${repoName(repo)}`;
