export type ExecOutput = { stream: 'stdout' | 'stderr'; data: string };

export type IdlePolicy = { ms: number; action: 'kill' | 'pause' };

export type Shell = {
  sendInput(data: Uint8Array): Promise<void>;
  resize(size: { cols: number; rows: number }): Promise<void>;
  /** Resolves with the shell's exit code. */
  wait(): Promise<number>;
};

/** A running sandbox. Everything the CLI needs from a provider goes through here. */
export type Box = {
  id: string;
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

export type BoxSummary = {
  name: string;
  state: string;
  id: string;
  image: string;
};

/**
 * A sandbox backend. Boxes are addressed by a user-chosen name that the
 * provider must keep unique among live boxes.
 *
 * Providers own the idle policy: a box must expire on its own after the
 * configured idle time with no l2b activity, and any `exec` or `shell` must
 * hold that deadline off while it runs.
 */
export type Provider = {
  id: string;
  /** Image used when the user does not pick one. */
  defaultImage: string;
  create(opts: { name: string; image: string; workdir: string }): Promise<Box>;
  connect(opts: { name: string }): Promise<Box>;
  list(): Promise<BoxSummary[]>;
  exists(opts: { name: string }): Promise<boolean>;
  /** Image reference for a snapshot made by `Box.snapshot`, or null. */
  findSnapshot(opts: { name: string }): Promise<string | null>;
  /** Builds the tooling-only base image and returns its reference. */
  buildImage(): Promise<string>;
};
