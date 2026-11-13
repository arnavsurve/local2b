import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { cloneSchema, repoConfigSchema, type Config } from './config';
import { gitHostSchema } from './git-host';
import { parseRepo } from './repo';
import { secretSourceSchema } from './secrets';

export const PROJECT_FILE = '.l2b.json';

const repoSlugSchema = z.string().refine(
  (repo) => {
    try {
      parseRepo(repo);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'expected owner/name' }
);

/**
 * A project's own settings, read from the nearest `.l2b.json`. null leaves a
 * key to the user config (`repos.<o/r>`, then the globals).
 */
export const projectConfigSchema = z.strictObject({
  /** The repo this file is for. When set, l2b refuses to apply it to any other repo. */
  repo: repoSlugSchema.nullable().default(null),
  /** Branch the bake is made from; null for the remote's default branch. */
  baseBranch: z.string().min(1).nullable().default(null),
  /** Overrides `strategy`, `depth` and `filter` field by field. */
  clone: cloneSchema.strict().default({}),
  /** Plain, non-secret variables set in every box, over the user config's. */
  env: z.record(z.string(), z.string()).default({}),
  provider: z.string().min(1).nullable().default(null),
  gitHost: gitHostSchema.nullable().default(null),
  /** Runs in the checkout on every start and at bake; keep it incremental. */
  install: z.string().nullable().default(null),
  /** Runs once at bake, after install. */
  warm: z.string().nullable().default(null),
  /** Secret sources added to the user config's. */
  secrets: z.array(secretSourceSchema).default([]),
});
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export type FoundProject = { path: string; config: ProjectConfig };

async function readProjectConfig({ path }: { path: string }): Promise<ProjectConfig> {
  let raw: unknown;
  try {
    raw = await Bun.file(path).json();
  } catch (err) {
    throw new Error(`invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = projectConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid ${path}:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** The nearest `.l2b.json` from `cwd` up to the filesystem root, or null. */
export async function findProjectConfig({ cwd }: { cwd: string }): Promise<FoundProject | null> {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const path = join(dir, PROJECT_FILE);
    if (await Bun.file(path).exists()) return { path, config: await readProjectConfig({ path }) };
    if (dirname(dir) === dir) return null;
  }
}

/**
 * The user config with `project` laid over `repos.<repo>`, so everything that
 * reads a repo's settings sees the project's first. Project secrets are added
 * after the user's, so they win a name clash.
 */
export function withProjectConfig({
  config,
  repo,
  project,
}: {
  config: Config;
  repo: string;
  project: ProjectConfig;
}): Config {
  const own = config.repos[repo] ?? repoConfigSchema.parse({});
  return {
    ...config,
    secrets: [...config.secrets, ...project.secrets],
    repos: {
      ...config.repos,
      [repo]: {
        provider: project.provider ?? own.provider,
        clone: { ...own.clone, ...project.clone },
        gitHost: project.gitHost ?? own.gitHost,
        baseBranch: project.baseBranch ?? own.baseBranch,
        install: project.install ?? own.install,
        warm: project.warm ?? own.warm,
        env: { ...own.env, ...project.env },
      },
    },
  };
}
