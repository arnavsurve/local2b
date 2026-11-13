import { randomUUID } from 'node:crypto';
import { Sandbox, Template } from 'e2b';
import { ProviderAuthError } from '../types';
import type { IdlePolicy, Machine, MachineHost } from '../../toolkit/machine';
import { withHeartbeat } from '../../toolkit/keepalive';
import type { Config } from '../../config';
import { resolveValue, type ValueRef } from '../../secrets';
import { devTemplate } from './template';
import { l2bSnapshotName, snapshotHasName } from './snapshot-match';

const NAME_KEY = 'l2b';
const WORKDIR_KEY = 'l2b_workdir';
const HOME_DIR = '/home/user';
const HEARTBEATS_PER_IDLE_WINDOW = 3;
const BUILD_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
const LIVE_STATES: ('running' | 'paused')[] = ['running', 'paused'];
const PIN_TAG_PREFIX = 'l2b-';

/** A tag unique to one build, so `<template>:<tag>` always means that build. */
const newPinTag = () => `${PIN_TAG_PREFIX}${randomUUID()}`;
const pinnedRef = ({ template, tag }: { template: string; tag: string }) => `${template}:${tag}`;

/** The pin tag in `ref`, or null when `ref` is not a pinned build of `template`. */
function pinTag({ template, ref }: { template: string; ref: string }) {
  const prefix = `${template}:${PIN_TAG_PREFIX}`;
  return ref.startsWith(prefix) ? ref.slice(template.length + 1) : null;
}

function wrapBox({
  sandbox,
  idle,
  workdir,
  homeDir,
}: {
  sandbox: Sandbox;
  idle: IdlePolicy;
  workdir: string;
  homeDir: string;
}): Machine {
  const keepAlive = () => sandbox.setTimeout(idle.ms);
  const held = <T>(task: () => Promise<T>) =>
    withHeartbeat({
      intervalMs: idle.ms / HEARTBEATS_PER_IDLE_WINDOW,
      beat: keepAlive,
      task,
    });

  return {
    id: sandbox.sandboxId,
    workdir,
    homeDir,
    exec: ({ cmd, cwd, onOutput }) =>
      held(async () => {
        try {
          const result = await sandbox.commands.run(cmd, {
            cwd,
            timeoutMs: 0,
            onStdout: (data) => onOutput({ stream: 'stdout', data }),
            onStderr: (data) => onOutput({ stream: 'stderr', data }),
          });
          return result.exitCode;
        } catch (err) {
          if (err instanceof Error && 'exitCode' in err && typeof err.exitCode === 'number') {
            return err.exitCode;
          }
          throw err;
        }
      }),
    async shell({ cols, rows, cwd, onData }) {
      const handle = await sandbox.pty.create({ cols, rows, cwd, onData, timeoutMs: 0 });
      return {
        sendInput: (data) => sandbox.pty.sendInput(handle.pid, data),
        resize: (size) => sandbox.pty.resize(handle.pid, size),
        wait: () =>
          held(async () => {
            try {
              return (await handle.wait()).exitCode;
            } catch (err) {
              if (err instanceof Error && 'exitCode' in err && typeof err.exitCode === 'number') {
                return err.exitCode;
              }
              throw err;
            }
          }),
      };
    },
    async writeFile({ path, content }) {
      await sandbox.files.write(path, content);
    },
    publicUrl: ({ port }) => `https://${sandbox.getHost(port)}`,
    pause: async () => {
      await sandbox.pause();
    },
    destroy: async () => {
      await sandbox.kill();
    },
    async snapshot({ name }) {
      const snapshot = await sandbox.createSnapshot({ name, mode: 'filesystem' });
      return snapshot.snapshotId;
    },
  };
}

function describeRef({ ref }: { ref: ValueRef }) {
  switch (ref.from) {
    case 'env':
      return `set ${ref.name}, or point e2b.apiKey at another value reference`;
    case 'file':
      return `put the key in ${ref.path}, or change e2b.apiKey`;
    case 'doppler':
    case 'firstOf':
    case 'command':
      return 'check the e2b.apiKey value reference in your config';
    default: {
      const unreachable: never = ref;
      throw new Error(`unknown value ref: ${JSON.stringify(unreachable)}`);
    }
  }
}

/** e2b sandboxes as toolkit machines: metadata names, server-side timeouts re-armed by a heartbeat, filesystem snapshots. */
export function createE2bMachineHost({
  config,
  idle,
}: {
  config: Config['e2b'];
  idle: IdlePolicy;
}): MachineHost {
  const apiKey = async () => {
    try {
      return await resolveValue(config.apiKey);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ProviderAuthError({
        provider: 'e2b',
        hint: `${reason}; ${describeRef({ ref: config.apiKey })}`,
      });
    }
  };

  /** Every snapshot on the account, page by page. */
  async function allSnapshots() {
    const paginator = Sandbox.listSnapshots({ apiKey: await apiKey() });
    const found = [];
    do {
      found.push(...(await paginator.nextItems()));
    } while (paginator.hasNext);
    return found;
  }

  async function findInfo({ name }: { name: string }) {
    const paginator = Sandbox.list({
      apiKey: await apiKey(),
      query: { metadata: { [NAME_KEY]: name }, state: LIVE_STATES },
    });
    const items = await paginator.nextItems();
    return items[0] ?? null;
  }

  const template = () =>
    devTemplate({
      features: config.features,
      nodeMajor: config.nodeMajor,
      npmGlobals: config.npmGlobals,
      aptPackages: config.aptPackages,
      imageCommands: config.imageCommands,
    });

  return {
    id: 'e2b',
    homeDir: HOME_DIR,
    defaultImage: config.template,

    async create({ name, image, workdir, idle: override }) {
      const policy = override ? { ...idle, ms: override.minutes * 60_000 } : idle;
      if (await findInfo({ name })) {
        throw new Error(
          `sandbox "${name}" already exists: reuse it with \`l2b exec ${name} -- <cmd>\`, or \`l2b down ${name}\` first`
        );
      }
      const sandbox = await Sandbox.create(image, {
        apiKey: await apiKey(),
        timeoutMs: policy.ms,
        lifecycle: { onTimeout: policy.action },
        metadata: { [NAME_KEY]: name, [WORKDIR_KEY]: workdir },
      });
      return wrapBox({ sandbox, idle: policy, workdir, homeDir: HOME_DIR });
    },

    async connect({ name }) {
      const info = await findInfo({ name });
      if (!info) throw new Error(`no sandbox named "${name}"; start one with \`l2b up ${name}\`, or list running boxes with \`l2b ls\``);
      const sandbox = await Sandbox.connect(info.sandboxId, {
        apiKey: await apiKey(),
        timeoutMs: idle.ms,
      });
      return wrapBox({
        sandbox,
        idle,
        workdir: info.metadata[WORKDIR_KEY] ?? HOME_DIR,
        homeDir: HOME_DIR,
      });
    },

    async list() {
      const paginator = Sandbox.list({
        apiKey: await apiKey(),
        query: { state: LIVE_STATES },
      });
      const items = await paginator.nextItems();
      return items.flatMap((info) => {
        const name = info.metadata[NAME_KEY];
        if (!name) return [];
        return [{ name, state: info.state, id: info.sandboxId, image: info.templateId }];
      });
    },

    async exists({ name }) {
      return (await findInfo({ name })) !== null;
    },

    async findSnapshot({ name }) {
      const snapshot = (await allSnapshots()).find((s) => snapshotHasName({ names: s.names, name }));
      return snapshot ? { id: snapshot.snapshotId, createdAt: null } : null;
    },

    async listSnapshots() {
      return (await allSnapshots()).flatMap((snapshot) => {
        const name = l2bSnapshotName({ names: snapshot.names });
        return name ? [{ name, id: snapshot.snapshotId, createdAt: null }] : [];
      });
    },

    async deleteSnapshot({ name }) {
      const matching = (await allSnapshots()).filter((s) => snapshotHasName({ names: s.names, name }));
      const key = await apiKey();
      for (const snapshot of matching) await Sandbox.deleteSnapshot(snapshot.snapshotId, { apiKey: key });
      return matching.length > 0;
    },

    imageRecipe: () =>
      JSON.stringify({ dockerfile: Template.toDockerfile(template()), cpuCount: config.cpuCount, memoryMB: config.memoryMB }),

    /** A tag names one build for good; the template's name follows whichever build e2b serves as `default`, which can lag a rebuild. */
    async imageExists({ ref }) {
      const tag = pinTag({ template: config.template, ref });
      if (tag === null) return false;
      const key = await apiKey();
      if (!(await Template.exists(config.template, { apiKey: key }))) return false;
      return (await Template.getTags(config.template, { apiKey: key })).some((t) => t.tag === tag);
    },

    /** `default` appears once a build is done. A build l2b did not tag (or tagged elsewhere) gets a tag here. */
    async currentImage() {
      const key = await apiKey();
      if (!(await Template.exists(config.template, { apiKey: key }))) return null;
      const tags = await Template.getTags(config.template, { apiKey: key });
      const current = tags.find((t) => t.tag === 'default');
      if (!current) return null;
      const pinned = tags.find((t) => t.buildId === current.buildId && t.tag.startsWith(PIN_TAG_PREFIX));
      if (pinned) return pinnedRef({ template: config.template, tag: pinned.tag });
      const tag = newPinTag();
      await Template.assignTags(`${config.template}:default`, tag, { apiKey: key });
      return pinnedRef({ template: config.template, tag });
    },

    async buildImage() {
      const tag = newPinTag();
      await Template.build(template(), config.template, {
        apiKey: await apiKey(),
        tags: ['default', tag],
        cpuCount: config.cpuCount,
        memoryMB: config.memoryMB,
        requestTimeoutMs: BUILD_REQUEST_TIMEOUT_MS,
      });
      return pinnedRef({ template: config.template, tag });
    },
  };
}
