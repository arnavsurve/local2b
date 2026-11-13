import { PROJECT_FILE } from './project-config';
import type { RepoSpec } from './providers/types';
import type { Target } from './target';

const COMMAND_NOT_FOUND = 127;

/** Says so when a repo box gets no setup and no install because no project file was found. */
export function warnIfUnconfigured({ target, repo }: { target: Target; repo: RepoSpec | null }) {
  if (!repo || target.project || repo.setup.length > 0 || repo.install) return;
  console.error(`l2b: no ${PROJECT_FILE} found from ${target.ctx.cwd}; nothing set up or installed (see l2b init)`);
}

/** Points at `setup` when a box command exits with the shell's "command not found" code. */
export function hintOnExit({ exitCode }: { exitCode: number }) {
  if (exitCode !== COMMAND_NOT_FOUND) return;
  console.error(`l2b: exit 127: a command was not found in the box; install it with "setup" in ${PROJECT_FILE}`);
}
