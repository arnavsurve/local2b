import { createHash } from 'node:crypto';
import { constants } from 'node:os';
import { posix } from 'node:path';
import type { CreateSandboxRequest, Sandbox } from '@boatdev/sdk';
import type { Config } from '../../config';
import { shellQuote } from '../../shell';
import type { BoxSummary } from '../types';

/**
 * Pure request shaping for the boat adapter: what a box is created with, how
 * it is found again, and where a write may go. Nothing here talks to boat.
 */

export const HOME_DIR = '/home/user';
/** `image` value meaning boat's stock image (no saved snapshot). */
export const STOCK_IMAGE = 'stock';
/** Bake `l2b image build` makes when the config adds tools to the stock image. */
export const BASE_SNAPSHOT = 'l2b-base';

const NAME_LABEL = 'l2b';
const WORKDIR_LABEL = 'l2b-workdir';
const IMAGE_LABEL = 'l2b-image';
const BAKE_LABEL = 'l2b-bake';

/** States of a box that is up or on its way up. Stopped, failed and cancelled boxes are gone as far as l2b is concerned. */
export const LIVE_STATES = ['init', 'provisioning', 'provisioned', 'cloning', 'ready', 'idle', 'running'] as const;

const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;

/** boat's auto-stop deadline for an idle window, inside the range boat accepts. */
export function ttlSeconds({ idleMs }: { idleMs: number }) {
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.ceil(idleMs / 1000)));
}

const labelsFor = ({ name, workdir, image }: { name: string; workdir: string; image: string }) => ({
  [NAME_LABEL]: name,
  [WORKDIR_LABEL]: workdir,
  [IMAGE_LABEL]: image,
});

const environmentOf = ({ config }: { config: Pick<Config['boat'], 'environment'> }) =>
  config.environment === null ? { noEnv: true } : { environment: config.environment };

/**
 * A box is either an ordinary box, with snapshots off so boat never copies
 * its disk off the machine and the stop at the end of its idle window erases
 * it, or a bake box (`bake` names the bake). A bake box has snapshots on: once
 * baked it is stopped, and boat keeps its disk for later boxes to fork.
 * `image` is the stock image or a saved snapshot to start from.
 *
 * Monitoring is off, so boat keeps no command history or output.
 * Credentials are never part of the request.
 */
export function createRequest({
  name,
  image,
  workdir,
  idleMs,
  config,
  bake,
}: {
  name: string;
  image: string;
  workdir: string;
  idleMs: number;
  config: Pick<Config['boat'], 'type' | 'environment'>;
  bake: string | null;
}): CreateSandboxRequest {
  return {
    name,
    type: config.type,
    ttlSeconds: ttlSeconds({ idleMs }),
    labels: { ...labelsFor({ name, workdir, image }), ...(bake === null ? {} : { [BAKE_LABEL]: bake }) },
    snapshots: bake !== null,
    monitoring: false,
    ...environmentOf({ config }),
    ...(image === STOCK_IMAGE ? {} : { from: image }),
  };
}

/**
 * A box forked from a bake, with the same meaning of `bake` as in
 * `createRequest`. A fork never takes its source's labels, so an ordinary box
 * is never mistaken for the bake. `snapshots` is not in boat's documented fork
 * request; the adapter sends it and deletes stopped forks either way.
 */
export function forkRequest({
  name,
  image,
  workdir,
  idleMs,
  config,
  bake,
}: {
  name: string;
  image: string;
  workdir: string;
  idleMs: number;
  config: Pick<Config['boat'], 'type' | 'environment'>;
  bake: string | null;
}) {
  return {
    type: config.type,
    ttlSeconds: ttlSeconds({ idleMs }),
    labels: { ...labelsFor({ name, workdir, image }), ...(bake === null ? {} : { [BAKE_LABEL]: bake }) },
    monitoring: false,
    snapshots: bake !== null,
    ...environmentOf({ config }),
  };
}

/** The `label` filter for a bake's boxes. */
export const bakeFilter = ({ bake }: { bake: string }) => [`${BAKE_LABEL}=${bake}`];

/** Display name a bake box gets once its bake succeeded; a failed bake box never has it. */
export const bakedBoxName = ({ bake }: { bake: string }) => `l2b-bake-${bake}`;

/**
 * The newest finished bake among `sandboxes`: stopped, named as baked, and
 * with its disk still kept (boat deletes it some time after 14 days).
 */
export function newestBake<T extends Pick<Sandbox, 'id' | 'name' | 'state' | 'labels' | 'stoppedAt' | 'dataExpiredAt'>>({
  sandboxes,
  bake,
}: {
  sandboxes: T[];
  bake: string;
}): (T & { stoppedAt: Date }) | null {
  const done = sandboxes.filter(
    (s): s is T & { stoppedAt: Date } =>
      s.state === 'archived' &&
      s.name === bakedBoxName({ bake }) &&
      s.labels?.[BAKE_LABEL] === bake &&
      !s.dataExpiredAt &&
      s.stoppedAt instanceof Date
  );
  done.sort((a, b) => b.stoppedAt.getTime() - a.stoppedAt.getTime());
  return done[0] ?? null;
}

/** The newest finished bake of each repo among `sandboxes`. The base image bake is not a repo's. */
export function repoBakes<T extends Pick<Sandbox, 'id' | 'name' | 'state' | 'labels' | 'stoppedAt' | 'dataExpiredAt'>>({
  sandboxes,
}: {
  sandboxes: T[];
}) {
  const names = new Set(sandboxes.flatMap((s) => s.labels?.[BAKE_LABEL] ?? []).filter((name) => name !== BASE_SNAPSHOT));
  return [...names].flatMap((name) => {
    const bake = newestBake({ sandboxes, bake: name });
    return bake ? [{ name, id: bake.id, createdAt: bake.stoppedAt }] : [];
  });
}

/** A stopped l2b box that is not a finished bake: it expired, so the adapter deletes it. */
export function isExpiredBox({ sandbox }: { sandbox: Pick<Sandbox, 'name' | 'state' | 'labels'> }) {
  if (sandbox.state !== 'archived' || !sandbox.labels?.[NAME_LABEL]) return false;
  const bake = sandbox.labels[BAKE_LABEL];
  return !bake || sandbox.name !== bakedBoxName({ bake });
}

/** The `label` filter that finds the box called `name`. */
export const nameFilter = ({ name }: { name: string }) => [`${NAME_LABEL}=${name}`];

export const workdirOf = ({ sandbox }: { sandbox: Pick<Sandbox, 'labels'> }) => sandbox.labels?.[WORKDIR_LABEL] ?? HOME_DIR;

/** A boat sandbox as an l2b box, or null when l2b did not make it. */
export function summaryOf({ sandbox }: { sandbox: Pick<Sandbox, 'id' | 'state' | 'labels'> }): BoxSummary | null {
  const name = sandbox.labels?.[NAME_LABEL];
  if (!name) return null;
  return { name, state: sandbox.state, id: sandbox.id, image: sandbox.labels?.[IMAGE_LABEL] ?? STOCK_IMAGE };
}

const SAVED_NAME_MAX = 63;

/** A saved snapshot name boat accepts (`^[a-z0-9][a-z0-9-]{0,62}$`), stable for the same input. */
export function savedSnapshotName({ name }: { name: string }) {
  const slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+/, '');
  if (slug.length > 0 && slug.length <= SAVED_NAME_MAX) return slug;
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 8);
  return `${slug.slice(0, SAVED_NAME_MAX - hash.length - 1).replace(/-+$/, '') || 'l2b'}-${hash}`;
}

/**
 * How a file reaches the box. boat's file API only writes under the home
 * directory and `/tmp`, both on disk. Anything else, including the tmpfs
 * credentials file, goes over SSH stdin, so a secret never passes through
 * the file API or lands on disk.
 */
export function writeRoute({ path }: { path: string }): 'files-api' | 'ssh' {
  const normal = posix.normalize(path);
  return normal.startsWith(`${HOME_DIR}/`) || normal.startsWith('/tmp/') ? 'files-api' : 'ssh';
}

/** Runs `cmd` in `cwd`. boat's own `cwd` is relative to the home directory, so the adapter changes directory itself. */
export function inDirCommand({ cwd, cmd }: { cwd: string; cmd: string }) {
  return `cd ${shellQuote(cwd)} || exit 1\n${cmd}`;
}

/** The exit code of a finished command: its own, else 128 plus the signal that ended it. */
export function exitCodeOf({ frame }: { frame: { exitCode?: number | null; signal?: unknown } }) {
  if (typeof frame.exitCode === 'number') return frame.exitCode;
  if (typeof frame.signal === 'number') return 128 + frame.signal;
  if (typeof frame.signal === 'string') {
    const number = constants.signals[frame.signal as keyof typeof constants.signals];
    if (typeof number === 'number') return 128 + number;
  }
  return 1;
}

/** Where to SSH: `sshEndpoint` (`host:port`) when boat sets it, else the machine's own address on port 22. */
export function sshTarget({ machineIp, sshEndpoint }: { machineIp?: string | null; sshEndpoint?: string | null }) {
  if (sshEndpoint) {
    const at = sshEndpoint.lastIndexOf(':');
    return { host: sshEndpoint.slice(0, at), port: Number(sshEndpoint.slice(at + 1)) };
  }
  if (!machineIp) throw new Error('boat returned no address to SSH to');
  return { host: machineIp, port: 22 };
}

/** OpenSSH options that use only this key and the host key boat reported, ignoring the user's own ssh config. */
export function sshArgs({
  keyFile,
  knownHostsFile,
  alias,
  target,
}: {
  keyFile: string;
  knownHostsFile: string;
  alias: string;
  target: { host: string; port: number };
}) {
  const options = [
    'IdentitiesOnly=yes',
    'IdentityAgent=none',
    'BatchMode=yes',
    'StrictHostKeyChecking=yes',
    `UserKnownHostsFile=${knownHostsFile}`,
    'GlobalKnownHostsFile=/dev/null',
    `HostKeyAlias=${alias}`,
    'ConnectTimeout=30',
    'ServerAliveInterval=30',
    'LogLevel=ERROR',
  ];
  return [
    '-F',
    '/dev/null',
    '-i',
    keyFile,
    '-p',
    String(target.port),
    ...options.flatMap((option) => ['-o', option]),
    `user@${target.host}`,
  ];
}

/** Removes one authorized public key again, matched by its key body. */
export function revokeKeyCommand({ publicKey }: { publicKey: string }) {
  const body = publicKey.trim().split(/\s+/)[1];
  if (!body || !/^[A-Za-z0-9+/=]+$/.test(body)) throw new Error('not an OpenSSH public key');
  return `f="$HOME/.ssh/authorized_keys"; [ -f "$f" ] || exit 0; t=$(mktemp) && { grep -vF ${shellQuote(body)} "$f" > "$t"; cat "$t" > "$f"; rm -f "$t"; }`;
}

/** Remote command that writes stdin to `path` with no read access for anyone else. */
export function writeStdinCommand({ path }: { path: string }) {
  return `umask 077 && mkdir -p ${shellQuote(posix.dirname(path))} && cat > ${shellQuote(path)}`;
}

/** What `l2b image build` runs on top of the stock image, or null when the config adds nothing. */
export function baseImageScript({ aptPackages, imageCommands }: Pick<Config['boat'], 'aptPackages' | 'imageCommands'>) {
  if (aptPackages.length === 0 && imageCommands.length === 0) return null;
  const apt = aptPackages.length
    ? [`sudo apt-get update -q && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q ${aptPackages.map(shellQuote).join(' ')}`]
    : [];
  return ['set -e', ...apt, ...imageCommands].join('\n');
}

/**
 * Some boat machines resolve hosts to IPv6 first but have no IPv6 route out,
 * which leaves clients without a fallback (bun install) hanging. On such a
 * machine, prefer IPv4 addresses.
 */
export const PREFER_IPV4_WITHOUT_IPV6_ROUTE = [
  'ip -6 route show default 2>/dev/null | grep -q . && exit 0',
  "rule='precedence ::ffff:0:0/96  100'",
  'grep -qxF "$rule" /etc/gai.conf 2>/dev/null || echo "$rule" | sudo tee -a /etc/gai.conf >/dev/null',
].join('\n');

/** Keeps boat's per-command output logs out of a bake's disk snapshot. */
export const IGNORE_COMMAND_LOGS = `f="$HOME/.boatignore"; grep -qxF '.ascii/processes/' "$f" 2>/dev/null || echo '.ascii/processes/' >> "$f"`;
