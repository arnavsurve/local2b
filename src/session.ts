import { credentialHelperCommand, resolveHostToken, tokenEnvVar, type GitHost } from './git-host';
import type { Box } from './providers/types';
import {
  loadSecrets,
  toEnvFile,
  type SecretSource,
} from './secrets';

export const ENV_FILE = '/dev/shm/l2b.env';
export const PLAIN_ENV_FILE = '/home/user/.l2b-env';

export class CommandFailedError extends Error {
  constructor(
    readonly what: string,
    readonly exitCode: number
  ) {
    super(`${what} failed (exit ${exitCode})`);
  }
}

/** Plain env is sourced first so a secret of the same name wins. */
export function withEnv(cmd: string) {
  return `for f in ${PLAIN_ENV_FILE} ${ENV_FILE}; do [ -f $f ] && . $f; done; ${cmd}`;
}

/**
 * Credentials are resolved locally at call time and written to the sandbox's
 * tmpfs, never baked into an image or written to its disk.
 */
export async function pushCreds({
  box,
  sources,
  host,
}: {
  box: Box;
  sources: SecretSource[];
  host: GitHost;
}) {
  const vars: Record<string, string> = {};
  for (const source of sources) Object.assign(vars, await loadSecrets(source));
  vars[tokenEnvVar(host)] = await resolveHostToken(host);
  await box.writeFile({ path: ENV_FILE, content: toEnvFile(vars) });
  await box.exec({
    cmd: `chmod 600 ${ENV_FILE}`,
    cwd: '/',
    onOutput: () => {},
  });
}

/**
 * Plain (non-secret) variables live on disk so they survive `creds` refreshes,
 * which only rewrite the tmpfs secrets file.
 */
export async function pushEnv({
  box,
  env,
}: {
  box: Box;
  env: Record<string, string>;
}) {
  await box.writeFile({ path: PLAIN_ENV_FILE, content: toEnvFile(env) });
}

export async function configureGit({ box, host }: { box: Box; host: GitHost }) {
  await run({ box, cmd: credentialHelperCommand(host), cwd: '/' });
}

export async function scrubCreds({ box }: { box: Box }) {
  await box.exec({ cmd: `rm -f ${ENV_FILE}`, cwd: '/', onOutput: () => {} });
}

/** Streams output to this process and resolves with the remote exit code. */
export function run({ box, cmd, cwd }: { box: Box; cmd: string; cwd: string }) {
  return box.exec({
    cmd: withEnv(cmd),
    cwd,
    onOutput: ({ stream, data }) => {
      (stream === 'stdout' ? process.stdout : process.stderr).write(data);
    },
  });
}

export async function runChecked({
  box,
  cmd,
  cwd,
  what,
}: {
  box: Box;
  cmd: string;
  cwd: string;
  what: string;
}) {
  const exitCode = await run({ box, cmd, cwd });
  if (exitCode !== 0) throw new CommandFailedError(what, exitCode);
}
