import { join } from 'node:path';
import type { Command } from '../context';
import { resolveGitHost } from '../git-host';
import { readCheckout, repoFromRemote } from '../local-checkout';
import { PROJECT_FILE } from '../project-config';

const README_SECTION = 'https://github.com/arnavsurve/local2b#project-config';

/**
 * Writes a starter `.l2b.json` in cwd with every key, filling in the repo and
 * its default branch when cwd is a checkout on the configured git host.
 */
export const init: Command = async ({ ctx }) => {
  const path = join(ctx.cwd, PROJECT_FILE);
  if (await Bun.file(path).exists()) throw new Error(`${path} already exists; edit it instead`);
  const checkout = await readCheckout({ cwd: ctx.cwd });
  const baseUrl = resolveGitHost(ctx.config.gitHost).baseUrl;
  const repo = checkout?.origin ? repoFromRemote({ remote: checkout.origin, baseUrl }) : null;
  const starter = {
    repo,
    baseBranch: repo ? (checkout?.defaultBranch ?? null) : null,
    setup: [],
    install: null,
    warm: null,
    env: {},
    secrets: [],
    clone: {},
    provider: null,
    gitHost: null,
  };
  await Bun.write(path, `${JSON.stringify(starter, null, 2)}\n`);
  console.log(`wrote ${path}`);
  console.log(`set setup and install for this project; see ${README_SECTION}`);
};
