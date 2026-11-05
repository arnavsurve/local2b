import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { DEFAULT_FEATURES, featureSchema } from './toolkit/recipe';
import { gitHostSchema } from './git-host';
import { PROVIDER_IDS } from './providers/ids';
import type { CloneSpec } from './providers/types';
import { FILTER_PATTERN } from './toolkit/git-scripts';
import { secretSourceSchema, valueRefSchema } from './secrets';

export const e2bConfigSchema = z
  .object({
  apiKey: valueRefSchema.default({ from: 'env', name: 'E2B_API_KEY' }),
  cpuCount: z.number().int().positive().default(4),
  memoryMB: z.number().int().positive().default(8192),
  /** Tooling baked into the base image. Defaults to everything; drop what you do not need. */
  features: z.array(featureSchema).default(DEFAULT_FEATURES),
  /** Node.js major version installed by the `node` feature. */
  nodeMajor: z.number().int().positive().default(24),
  /** Installed globally with npm; requires the `node` feature. */
  npmGlobals: z.array(z.string()).default([]),
  /** Extra apt packages baked into the base image, e.g. a toolchain a repo's build tooling shells out to. */
  aptPackages: z.array(z.string()).default([]),
  /** Shell commands run as the box user at image build, after the system packages (sudo is available), e.g. to install a toolchain. */
  imageCommands: z.array(z.string()).default([]),
  /** What e2b does to a box at the end of its idle window: `kill` discards it; `pause` keeps its disk and memory (and secrets). null: the deprecated top-level `idle.action`. */
  onIdle: z.enum(['kill', 'pause']).nullable().default(null),
  })
  .refine((e2b) => e2b.npmGlobals.length === 0 || e2b.features.includes('node'), {
    message: 'npmGlobals requires the "node" feature',
    path: ['features'],
  });

const cloneFilterSchema = z
  .string()
  .regex(FILTER_PATTERN, 'must look like a git partial-clone filter, e.g. "blob:limit=50m"');

/** Every field is optional so a repo's block overrides only what it sets. */
const cloneSchema = z.object({
  /** `mirror`: bare mirror plus a worktree checkout. `plain`: an ordinary clone. */
  strategy: z.enum(['mirror', 'plain']).optional(),
  /** Commits of history to keep; `null` for full history. */
  depth: z.number().int().positive().nullable().optional(),
  /** Git partial-clone filter; `null` for none. */
  filter: cloneFilterSchema.nullable().optional(),
});

const CLONE_DEFAULTS = { strategy: 'mirror', depth: 50, filter: 'blob:limit=50m' } as const;

const idleSchema = z.object({
  minutes: z.number().positive().default(15),
  /** Deprecated alias for `e2b.onIdle`, kept so existing configs still parse. */
  action: z.enum(['kill', 'pause']).default('kill'),
});

const rawConfigSchema = z.object({
  provider: z.enum(PROVIDER_IDS).default('e2b'),
  /** Overrides the provider's default base image. */
  image: z.string().nullable().default(null),
  /** Boxes expire this long after the last l2b activity against them. */
  idle: idleSchema.default(idleSchema.parse({})),
  /** Kept for compatibility: the global default for `clone.depth`. */
  cloneDepth: z.number().int().positive().optional(),
  /** How repos are cloned; repos can override it. */
  clone: cloneSchema.default({}),
  /** Git remote host and how to authenticate to it; repos can override it. */
  gitHost: gitHostSchema.prefault({ type: 'github' }),
  /** Git author set globally in every box. Defaults to the local `git config --global` user.name and user.email. */
  gitIdentity: z.object({ name: z.string().min(1), email: z.string().min(1) }).nullable().default(null),
  /** `up` and `run` hint to re-bake when the repo's snapshot is older than this. */
  staleSnapshotHours: z.number().positive().default(72),
  /** Variables pushed into every sandbox, in addition to the git host token. */
  secrets: z.array(secretSourceSchema).default([]),
  /** Per-repo settings, keyed by `owner/name`. */
  repos: z
    .record(
      z.string(),
      z.object({
        /** Provider used for this repo, ahead of the top-level `provider`. */
        provider: z.string().nullable().default(null),
        /** Overrides the global `clone` settings field by field. */
        clone: cloneSchema.default({}),
        /** Overrides the global `gitHost` for this repo. */
        gitHost: gitHostSchema.nullable().default(null),
        /** Branch the snapshot is baked from (the one you mostly work off), when it is not the repo's default branch. */
        baseBranch: z.string().nullable().default(null),
        /** Runs in the checkout on every `up`; keep it fast and incremental. */
        install: z.string().nullable().default(null),
        /** Extra one-time work at bake only (codegen, builds); its output ships in the snapshot. */
        warm: z.string().nullable().default(null),
        /** Plain variables set in every box for this repo, e.g. to switch off a wrapper that expects a local login. */
        env: z.record(z.string(), z.string()).default({}),
      })
    )
    .default({}),
  e2b: e2bConfigSchema.optional(),
});

/**
 * Provider blocks stay optional so a provider can be told apart as "has a
 * block" (configured) from "defaults only". Blocks are filled in with their
 * defaults here, so consumers always see a complete one.
 */
export const configSchema = rawConfigSchema.transform((raw) => {
  const e2b = raw.e2b ?? e2bConfigSchema.parse({});
  return {
    ...raw,
    e2b: { ...e2b, onIdle: e2b.onIdle ?? raw.idle.action },
    /** Providers with a config block, plus the default one. */
    configuredProviders: PROVIDER_IDS.filter((id) => id === raw.provider || raw[id] !== undefined),
  };
});
export type Config = z.infer<typeof configSchema>;

/** Effective clone options for a repo: repo block, then global block, then `cloneDepth`, then defaults. */
export function resolveClone({ config, repo }: { config: Config; repo: string }): CloneSpec {
  const own = config.repos[repo]?.clone ?? {};
  const global = config.clone;
  return {
    strategy: own.strategy ?? global.strategy ?? CLONE_DEFAULTS.strategy,
    depth: own.depth !== undefined ? own.depth
      : global.depth !== undefined ? global.depth
      : (config.cloneDepth ?? CLONE_DEFAULTS.depth),
    filter: own.filter !== undefined ? own.filter
      : global.filter !== undefined ? global.filter
      : CLONE_DEFAULTS.filter,
  };
}

export function configPath() {
  const explicit = process.env.L2B_CONFIG;
  if (explicit) return explicit;
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(configHome, 'l2b', 'config.json');
}

export async function loadConfig() {
  const file = Bun.file(configPath());
  if (!(await file.exists())) return configSchema.parse({});
  const parsed = configSchema.safeParse(await file.json());
  if (!parsed.success) {
    throw new Error(`invalid config ${configPath()}:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
