import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { secretSourceSchema, valueRefSchema } from './secrets';

const e2bConfigSchema = z.object({
  apiKey: valueRefSchema.default({ from: 'env', name: 'E2B_API_KEY' }),
  cpuCount: z.number().int().positive().default(4),
  memoryMB: z.number().int().positive().default(8192),
  npmGlobals: z.array(z.string()).default([]),
});

export const configSchema = z.object({
  provider: z.enum(['e2b']).default('e2b'),
  /** Overrides the provider's default base image. */
  image: z.string().nullable().default(null),
  /** Variables pushed into every sandbox, in addition to a GitHub token. */
  secrets: z.array(secretSourceSchema).default([]),
  /** Per-repo settings, keyed by `owner/name`. */
  repos: z
    .record(
      z.string(),
      z.object({ install: z.string().nullable().default(null) })
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
