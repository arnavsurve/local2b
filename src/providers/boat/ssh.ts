import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoatApi } from '@boatdev/sdk';
import { boatCall, warnOnError } from './api';
import { revokeKeyCommand, sshArgs, sshTarget, writeStdinCommand } from './requests';

const CONNECT_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2000;
/** ssh's own exit code for a connection or authentication failure. */
const SSH_ERROR = 255;

function requireTool(name: string) {
  if (!Bun.which(name)) throw new Error(`the boat provider needs \`${name}\` on PATH (for credentials and shells)`);
}

export type SshSession = {
  /** `ssh` argv up to and including the destination; append the remote command. */
  args: string[];
};

/**
 * Authorizes a fresh ed25519 key on the box, pins the host key boat reports,
 * runs `task`, then revokes the key and deletes the key pair. The private key
 * never leaves a mode-700 temp directory on this machine.
 */
export async function withSsh<T>({
  api,
  sandboxId,
  task,
}: {
  api: BoatApi;
  sandboxId: string;
  task: (session: SshSession) => Promise<T>;
}): Promise<T> {
  requireTool('ssh');
  requireTool('ssh-keygen');
  const dir = mkdtempSync(join(tmpdir(), 'l2b-boat-ssh-'));
  let publicKey: string | null = null;
  try {
    const keyFile = join(dir, 'key');
    const keygen = Bun.spawnSync(
      ['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', `l2b-${randomBytes(4).toString('hex')}`, '-f', keyFile],
      { stdout: 'ignore', stderr: 'pipe' }
    );
    if (keygen.exitCode !== 0) throw new Error(`ssh-keygen failed: ${keygen.stderr.toString().trim()}`);
    const key = readFileSync(`${keyFile}.pub`, 'utf8').trim();
    publicKey = key;
    const access = await boatCall({ what: 'ssh key', call: () => api.sshKey({ sandboxId, key }) });
    if (!access.hostKey) throw new Error('boat returned no SSH host key to pin');
    const alias = `l2b-boat-${sandboxId}`;
    const knownHostsFile = join(dir, 'known_hosts');
    writeFileSync(knownHostsFile, `${alias} ${access.hostKey}\n`);
    return await task({ args: ['ssh', ...sshArgs({ keyFile, knownHostsFile, alias, target: sshTarget(access) })] });
  } finally {
    if (publicKey) {
      const command = revokeKeyCommand({ publicKey });
      await api
        .command({ sandboxId, command, timeoutSeconds: 30 })
        .catch(warnOnError(`revoking the temporary ssh key on ${sandboxId} (its private key is already deleted locally)`));
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Writes `content` to `path` through SSH stdin. The content is never part of
 * a command line, an API request or boat's command history. Retries while
 * the new key is not yet accepted.
 */
export async function writeOverSsh({ session, path, content }: { session: SshSession; path: string; content: string }) {
  let stderr = '';
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
    const proc = Bun.spawn([...session.args, writeStdinCommand({ path })], {
      stdin: new TextEncoder().encode(content),
      stdout: 'ignore',
      stderr: 'pipe',
    });
    const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (code === 0) return;
    stderr = err.trim();
    if (code !== SSH_ERROR) throw new Error(`writing ${path} over ssh failed (exit ${code}): ${stderr}`);
    await Bun.sleep(RETRY_DELAY_MS);
  }
  throw new Error(`could not reach the box over ssh to write ${path}: ${stderr}`);
}

/**
 * An interactive `ssh -t` on this process's terminal. The parent stops
 * reading stdin while ssh owns it, so keystrokes and window resizes go
 * straight to ssh.
 */
export async function interactiveSsh({ session, remote }: { session: SshSession; remote: string }) {
  process.stdin.pause();
  try {
    for (let attempt = 1; ; attempt++) {
      const proc = Bun.spawn([...session.args.slice(0, -1), '-t', ...session.args.slice(-1), remote], {
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      });
      const code = await proc.exited;
      if (code !== SSH_ERROR || attempt >= CONNECT_ATTEMPTS) return code;
      await Bun.sleep(RETRY_DELAY_MS);
    }
  } finally {
    process.stdin.resume();
  }
}
