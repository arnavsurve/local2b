import { selectForRepo, type Context } from './context';
import { resolveGitHost } from './git-host';
import { branchWarning, readCheckout, repoFromRemote, type LocalCheckout } from './local-checkout';
import { findProjectConfig, withProjectConfig, type FoundProject } from './project-config';

/** The repo a command works on, with the project config applied and the provider picked for it. */
export type Target = {
  ctx: Context;
  repo: string | null;
  project: FoundProject | null;
  /** The checkout in cwd, when it is a checkout of `repo`. */
  local: LocalCheckout | null;
};

/**
 * `--repo` when given, else the `origin` of the checkout in cwd, else the
 * `repo` named by the nearest `.l2b.json`. That file is laid over the user
 * config for the repo, and must not name a different one.
 */
export async function resolveTarget({ ctx, repo: flag }: { ctx: Context; repo: string | null }): Promise<Target> {
  const project = await findProjectConfig({ cwd: ctx.cwd });
  const checkout = await readCheckout({ cwd: ctx.cwd });
  const baseUrl = resolveGitHost(project?.config.gitHost ?? ctx.config.gitHost).baseUrl;
  const checkoutRepo = checkout?.origin ? repoFromRemote({ remote: checkout.origin, baseUrl }) : null;
  if (flag === null && checkout?.origin && checkoutRepo === null) {
    throw new Error(`the origin remote is not on ${baseUrl}; pass --repo owner/name`);
  }
  const repo = flag ?? checkoutRepo ?? project?.config.repo ?? null;
  if (repo && project?.config.repo && project.config.repo !== repo) {
    throw new Error(`${project.path} is for ${project.config.repo}, not ${repo}`);
  }
  const config = repo && project ? withProjectConfig({ config: ctx.config, repo, project: project.config }) : ctx.config;
  return {
    ctx: selectForRepo({ ctx: { ...ctx, config }, repo }),
    repo,
    project,
    local: repo !== null && repo === checkoutRepo ? checkout : null,
  };
}

/** `--branch` when given, else the local checkout's branch, warning on stderr when the box will see something else. */
export function branchFor({ target, flag }: { target: Target; flag: string | null }) {
  if (flag !== null || !target.local) return flag;
  const warning = branchWarning({ branch: target.local.branch });
  if (warning) console.error(`l2b: ${warning}`);
  return target.local.branch?.name ?? null;
}
