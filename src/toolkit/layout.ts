import { parseRepo, repoName } from '../repo';

export const mirrorDir = ({ homeDir, repo }: { homeDir: string; repo: string }) => {
  const { owner, name } = parseRepo(repo);
  return `${homeDir}/mirrors/${owner}/${name}.git`;
};

/** Deliberately owner-independent: agents rely on <home>/<name>. */
export const checkoutDir = ({ homeDir, repo }: { homeDir: string; repo: string }) =>
  `${homeDir}/${repoName(repo)}`;

const slug = (part: string) => part.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const snapshotName = (repo: string) => {
  const { owner, name } = parseRepo(repo);
  return `l2b-${slug(owner)}-${slug(name)}`;
};
