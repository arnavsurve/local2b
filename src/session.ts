import { credentialHelperCommand, resolveHostToken, type ResolvedGitHost } from './git-host';
import type { Machine } from './toolkit/machine';
import { shellQuote } from './shell';
import {
  loadSecrets,
  toEnvFile,
  type SecretSource,
} from './secrets';

export const ENV_FILE = '/dev/shm/l2b.env';

export const plainEnvFile = ({ homeDir }: { homeDir: string }) =>
  `${homeDir}/.l2b-env`;

export class CommandFailedError extends Error {
  constructor(
    readonly what: string,
    readonly exitCode: number
  ) {
    super(`${what} failed (exit ${exitCode})`);
  }
}

/** Plain env is sourced first so a secret of the same name wins. */
export function withEnv({ homeDir, cmd }: { homeDir: string; cmd: string }) {
  return `for f in ${plainEnvFile({ homeDir })} ${ENV_FILE}; do [ -f $f ] && . $f; done; ${cmd}`;
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
  box: Machine;
  sources: SecretSource[];
  host: ResolvedGitHost;
}) {
  const vars: Record<string, string> = {};
  for (const source of sources) Object.assign(vars, await loadSecrets(source));
  vars[host.tokenEnvVar] = await resolveHostToken(host);
  // /dev/shm is sticky and world-writable, so with fs.protected_regular a
  // file-API write (often a different uid) cannot reopen an existing file
  // owned by the box user. Removing it first lets a refresh recreate it.
  await box.exec({ cmd: `rm -f ${ENV_FILE}`, cwd: '/', onOutput: () => {} });
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
  box: Machine;
  env: Record<string, string>;
}) {
  await box.writeFile({ path: plainEnvFile({ homeDir: box.homeDir }), content: toEnvFile(env) });
}

export async function configureGit({ box, host }: { box: Machine; host: ResolvedGitHost }) {
  await run({ box, cmd: credentialHelperCommand(host), cwd: '/' });
}

export type GitIdentity = { name: string; email: string };

/** The config override wins; otherwise the local global git identity. `null` when either part is unset. */
export async function resolveGitIdentity({ override }: { override: GitIdentity | null }) {
  if (override) return override;
  const read = async (key: string) => {
    const proc = Bun.spawn(['git', 'config', '--global', '--get', key], {
      stdout: 'pipe',
      stderr: 'ignore',
      env: process.env,
    });
    const text = (await new Response(proc.stdout).text()).trim();
    return (await proc.exited) === 0 && text ? text : null;
  };
  const [name, email] = await Promise.all([read('user.name'), read('user.email')]);
  return name && email ? { name, email } : null;
}

export function gitIdentityCommand({ identity }: { identity: GitIdentity }) {
  return `git config --global user.name ${shellQuote(identity.name)} && git config --global user.email ${shellQuote(identity.email)}`;
}

export async function configureGitIdentity({ box, identity }: { box: Machine; identity: GitIdentity | null }) {
  if (!identity) return;
  await run({ box, cmd: gitIdentityCommand({ identity }), cwd: '/' });
}

export async function scrubCreds({ box }: { box: Machine }) {
  await box.exec({ cmd: `rm -f ${ENV_FILE}`, cwd: '/', onOutput: () => {} });
}

/** Streams output to this process and resolves with the remote exit code. */
export function run({ box, cmd, cwd }: { box: Machine; cmd: string; cwd: string }) {
  return box.exec({
    cmd: withEnv({ homeDir: box.homeDir, cmd }),
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
  box: Machine;
  cmd: string;
  cwd: string;
  what: string;
}) {
  const exitCode = await run({ box, cmd, cwd });
  if (exitCode !== 0) throw new CommandFailedError(what, exitCode);
}
