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
