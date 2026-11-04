import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { DEFAULT_FEATURES, featureSchema } from './providers/e2b/image';
import { secretSourceSchema, valueRefSchema } from './secrets';

const e2bConfigSchema = z
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
  })
  .refine((e2b) => e2b.npmGlobals.length === 0 || e2b.features.includes('node'), {
    message: 'npmGlobals requires the "node" feature',
    path: ['features'],
  });

const idleSchema = z.object({
  minutes: z.number().positive().default(15),
  /** `kill` discards the box; `pause` keeps its disk and memory (and secrets) around. */
  action: z.enum(['kill', 'pause']).default('kill'),
});

export const configSchema = z.object({
  provider: z.enum(['e2b']).default('e2b'),
  /** Overrides the provider's default base image. */
  image: z.string().nullable().default(null),
  /** Boxes expire this long after the last l2b activity against them. */
  idle: idleSchema.default(idleSchema.parse({})),
  /** Commits of history kept in a baked mirror. */
  cloneDepth: z.number().int().positive().default(50),
  /** Variables pushed into every sandbox, in addition to a GitHub token. */
  secrets: z.array(secretSourceSchema).default([]),
  /** Per-repo settings, keyed by `owner/name`. */
  repos: z
    .record(
      z.string(),
      z.object({
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
  e2b: e2bConfigSchema.default(e2bConfigSchema.parse({})),
});
export type Config = z.infer<typeof configSchema>;

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
