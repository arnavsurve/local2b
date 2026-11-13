import type { ExecOutput } from '../providers/types';

/**
 * Low-level sandbox primitives. These are not the provider boundary (see
 * `Provider` in `src/providers/types.ts`); they are the building blocks the
 * shared toolkit composes into a workflow, for adapters that choose to use it.
 */

export type IdlePolicy = { ms: number; action: 'kill' | 'pause' };

export type Shell = {
  sendInput(data: Uint8Array): Promise<void>;
  resize(size: { cols: number; rows: number }): Promise<void>;
  /** Resolves with the shell's exit code. */
  wait(): Promise<number>;
};

/** A running sandbox machine. */
export type Machine = {
  id: string;
  /** The box user's home directory. */
  homeDir: string;
  /** Directory commands run in when no `--cwd` is given. */
  workdir: string;
  exec(opts: {
    cmd: string;
    cwd: string;
    onOutput: (output: ExecOutput) => void;
  }): Promise<number>;
  /** Interactive terminal session. Keeps the box alive while attached. */
  shell(opts: {
    cols: number;
    rows: number;
    cwd: string;
    onData: (data: Uint8Array) => void;
  }): Promise<Shell>;
  writeFile(opts: { path: string; content: string }): Promise<void>;
  publicUrl(opts: { port: number }): string;
  pause(): Promise<void>;
  destroy(): Promise<void>;
  /** Persists the filesystem only (no memory), returning a reference usable as an image. */
  snapshot(opts: { name: string }): Promise<string>;
};

export type MachineSummary = {
  name: string;
  state: string;
  id: string;
  image: string;
};

/**
 * Creates and finds machines. Machines are addressed by a user-chosen name
 * that the host must keep unique among live machines.
 *
 * The host owns the idle policy: a machine must expire on its own after the
 * configured idle time with no l2b activity, and any `exec` or `shell` must
 * hold that deadline off while it runs.
 */
export type MachineHost = {
  id: string;
  /** Home directory of the user inside this host's machines. */
  homeDir: string;
  /** Image used when the user does not pick one. */
  defaultImage: string;
  /** `idle` overrides the host's default idle window for this machine; null keeps the default. */
  create(opts: { name: string; image: string; workdir: string; idle: { minutes: number } | null }): Promise<Machine>;
  connect(opts: { name: string }): Promise<Machine>;
  list(): Promise<MachineSummary[]>;
  exists(opts: { name: string }): Promise<boolean>;
  /**
   * Image reference for a snapshot made by `Machine.snapshot`, or null.
   * `createdAt` is null when the host can't report it.
   */
  findSnapshot(opts: { name: string }): Promise<{ id: string; createdAt: Date | null } | null>;
  /** Every repo snapshot l2b made on this host, by the name it was made with. */
  listSnapshots(): Promise<{ name: string; id: string; createdAt: Date | null }[]>;
  /** Deletes every snapshot named `name`; resolves with whether there was one. */
  deleteSnapshot(opts: { name: string }): Promise<boolean>;
  /** Builds the tooling-only base image and returns its reference. */
  buildImage(): Promise<string>;
};
