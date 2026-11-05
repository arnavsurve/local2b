/**
 * The provider boundary. Core describes what it wants (a box for this repo and
 * branch, a bake, a command run) and checks the result; each provider decides
 * how to get there with its own primitives. The functionality expectations
 * below are enforced by the contract suite in `./contract.ts`, which every
 * provider must pass.
 */

export type ExecOutput = { stream: 'stdout' | 'stderr'; data: string };

/** How a repo is cloned. Providers may ignore `strategy` when it does not apply to them. */
export type CloneSpec = {
  /** `mirror`: bare mirror plus a worktree checkout. `plain`: an ordinary clone. */
  strategy: 'mirror' | 'plain';
  /** Commits of history to keep; null for full history. */
  depth: number | null;
  /** Git partial-clone filter; null for none. */
  filter: string | null;
};

/** Everything provider-neutral a provider needs to know about a repo. */
export type RepoSpec = {
  owner: string;
  name: string;
  remoteUrl: string;
  /** Branch a bake is made from; null for the remote's default branch. */
  baseBranch: string | null;
  clone: CloneSpec;
  /** Runs in the checkout at bake and on every start. null: detect it from the checkout. "": install nothing. */
  install: string | null;
  /** Runs in the checkout at bake only; null for none. */
  warm: string | null;
  /** Plain, non-secret variables set for every command. */
  env: Record<string, string>;
};

/** How git authenticates to the repo host. The token is `variables[tokenEnvVar]`. */
export type GitCredentials = { baseUrl: string; username: string; tokenEnvVar: string };

/**
 * Secret values resolved locally by core and handed to the provider.
 *
 * Functionality expectations:
 * - Every variable is in the environment of every command a box runs (exec, attach, install).
 * - Values are never persisted in any image, snapshot, bake or disk the provider keeps.
 * - Values never appear in a command line or in provider-side command history.
 */
export type Credentials = {
  variables: Record<string, string>;
  /** null when no git host authentication is configured. */
  git: GitCredentials | null;
};

export type BakeResult = {
  /** One line naming what was made, printed after `baked `. */
  summary: string;
  bakedAt: Date;
};

export type StartOpts = {
  /** Unique among the provider's live boxes. */
  name: string;
  /** null: a box with no checkout, whose workdir is the box user's home. */
  repo: RepoSpec | null;
  /** null: the remote's default branch. Starting from a bake, a branch missing on the remote is created from the default branch. */
  branch: string | null;
  /** `bake`: start from the repo's bake when one exists. `fresh`: ignore any bake. */
  source: 'bake' | 'fresh';
  /** A provider-interpreted base override (for example an image ref); null for the provider's own. */
  image: string | null;
  /** The box expires on its own after this long with no l2b activity. */
  idle: { minutes: number };
  credentials: Credentials;
  /** Git author for commits made in the box; null leaves git's own default. */
  gitIdentity: GitIdentity | null;
};

/** Set as the box user's global git `user.name` and `user.email`. */
export type GitIdentity = { name: string; email: string };

export type PublicUrl = {
  url: string;
  /** Anything the user must know to open it (a token, an expiry), or null. */
  note: string | null;
};

export type TerminalSize = { cols: number; rows: number };

/** The local terminal a box attaches to. */
export type Terminal = {
  size(): TerminalSize;
  /** Subscribes to keystrokes; returns the unsubscribe. */
  onInput(listener: (data: Uint8Array) => void): () => void;
  /** Subscribes to window resizes; returns the unsubscribe. */
  onResize(listener: (size: TerminalSize) => void): () => void;
  write(data: Uint8Array): void;
};

/**
 * A live box. Every command it runs sees the credentials and the repo's env,
 * and keeps the box from expiring while it runs.
 */
export type Box = {
  name: string;
  /** The repo checkout, or the box user's home when started without a repo. */
  workdir: string;
  /**
   * Runs `cmd` in a shell, in `cwd` (null: `workdir`), and resolves with its
   * exit code. `$HOME` is the box user's home. A process the command starts in
   * the background (`nohup ... &`) keeps running after `exec` resolves.
   */
  exec(opts: { cmd: string; cwd: string | null; onOutput: (output: ExecOutput) => void }): Promise<number>;
  /** Interactive shell; resolves with its exit code, or null when the provider cannot report one. */
  attach(opts: { terminal: Terminal; cwd: string | null }): Promise<number | null>;
  /**
   * Writes a text file and resolves with its absolute path. `path` is relative
   * to `workdir` unless it is absolute or starts with `~/` (the box user's
   * home). Parent directories are created, an existing file is replaced
   * (including one in a sticky directory such as `/tmp`), and `executable`
   * sets the exec bit.
   */
  put(opts: { path: string; content: string; executable: boolean }): Promise<string>;
  url(opts: { port: number }): Promise<PublicUrl>;
  /** Replaces the credentials later commands see. */
  refreshCredentials(opts: { credentials: Credentials }): Promise<void>;
  pause(): Promise<void>;
  destroy(): Promise<void>;
};

export type BoxSummary = {
  name: string;
  state: string;
  id: string;
  image: string;
};

/**
 * A sandbox backend. Boxes are addressed by a user-chosen name.
 *
 * Functionality expectations (see `describeProviderContract`):
 * - `start` with a repo yields a box whose workdir is a checkout of the branch
 *   with dependencies installed. If it fails, no box is left behind.
 * - A box expires on its own after `idle.minutes` with no l2b activity, with
 *   no local process required. How is up to the provider; it must say so in
 *   its own docs.
 * - Anything the provider cannot do throws `UnsupportedError`.
 * Policy beyond that (what pause keeps, ssh vs pty, snapshots, images,
 * lifetime caps) belongs to the provider and its own config block.
 */
export type Provider = {
  id: string;
  /** Makes whatever base the provider needs before any bake; returns a summary line. */
  prepare(): Promise<string>;
  /** Makes the repo's bake, so later starts are fast. */
  bake(opts: { repo: RepoSpec; credentials: Credentials; image: string | null }): Promise<BakeResult>;
  /** When the repo's current bake was made, or null when there is none or its age is unknown. */
  bakedAt(opts: { repo: RepoSpec }): Promise<Date | null>;
  start(opts: StartOpts): Promise<Box>;
  connect(opts: { name: string }): Promise<Box>;
  exists(opts: { name: string }): Promise<boolean>;
  list(): Promise<BoxSummary[]>;
};

/**
 * Thrown when a provider has no usable credentials. `l2b` skips such a
 * provider when it searches every configured provider, but reports the error
 * when the user picked that provider explicitly.
 */
export class ProviderAuthError extends Error {
  constructor({ provider, hint }: { provider: string; hint: string }) {
    super(`provider ${provider} cannot authenticate: ${hint}`);
    this.name = 'ProviderAuthError';
  }
}

/** Thrown when a step a provider runs for the user fails; l2b exits with its code. */
export class CommandFailedError extends Error {
  constructor(
    readonly what: string,
    readonly exitCode: number
  ) {
    super(`${what} failed (exit ${exitCode})`);
  }
}

/** Thrown for an operation a provider cannot perform. Core prints the message as is. */
export class UnsupportedError extends Error {
  constructor({
    provider,
    operation,
    suggestion,
  }: {
    provider: string;
    operation: string;
    suggestion: string | null;
  }) {
    super(`${provider} does not support ${operation}${suggestion ? `; ${suggestion}` : ''}`);
    this.name = 'UnsupportedError';
  }
}
