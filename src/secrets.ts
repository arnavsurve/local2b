import { $ } from 'bun';
import { z } from 'zod';
import { shellQuote } from './shell';

export const valueRefSchema = z.discriminatedUnion('from', [
  z.object({ from: z.literal('env'), name: z.string() }),
  z.object({
    from: z.literal('doppler'),
    project: z.string(),
    config: z.string(),
    name: z.string(),
  }),
]);
export type ValueRef = z.infer<typeof valueRefSchema>;

/** A bundle of variables injected into every sandbox. */
export const secretSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('doppler'),
    project: z.string(),
    config: z.string(),
  }),
  z.object({ type: z.literal('env'), names: z.array(z.string()) }),
]);
export type SecretSource = z.infer<typeof secretSourceSchema>;

type DopplerTarget = { project: string; config: string };

export function parseDopplerTarget(spec: string): SecretSource {
  const [project, config] = spec.split('/');
  if (!project || !config) {
    throw new Error(`doppler target must be <project>/<config>, got "${spec}"`);
  }
  return { type: 'doppler', project, config };
}

async function dopplerSecrets({ project, config }: DopplerTarget) {
  const out =
    await $`doppler secrets download --no-file --format json --project ${project} --config ${config}`
      .nothrow()
      .quiet();
  if (out.exitCode !== 0) {
    throw new Error(
      `doppler failed for ${project}/${config}: ${out.stderr.toString().trim()}`
    );
  }
  return z.record(z.string(), z.string()).parse(JSON.parse(out.text()));
}

export async function loadSecrets(source: SecretSource) {
  switch (source.type) {
    case 'doppler':
      return dopplerSecrets(source);
    case 'env': {
      const vars: Record<string, string> = {};
      for (const name of source.names) {
        const value = process.env[name];
        if (value === undefined) throw new Error(`env var ${name} is not set`);
        vars[name] = value;
      }
      return vars;
    }
    default: {
      const unreachable: never = source;
      throw new Error(`unknown secret source: ${JSON.stringify(unreachable)}`);
    }
  }
}

export async function resolveValue(ref: ValueRef) {
  switch (ref.from) {
    case 'env': {
      const value = process.env[ref.name];
      if (!value) throw new Error(`env var ${ref.name} is not set`);
      return value;
    }
    case 'doppler': {
      const value = (await dopplerSecrets(ref))[ref.name];
      if (!value) throw new Error(`${ref.name} missing in doppler ${ref.project}/${ref.config}`);
      return value;
    }
    default: {
      const unreachable: never = ref;
      throw new Error(`unknown value ref: ${JSON.stringify(unreachable)}`);
    }
  }
}

export async function githubToken() {
  const fromEnv = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (fromEnv) return fromEnv;
  const out = await $`gh auth token`.nothrow().quiet();
  if (out.exitCode !== 0) {
    throw new Error('no GitHub token: set GH_TOKEN or run `gh auth login`');
  }
  return out.text().trim();
}

export function toEnvFile(vars: Record<string, string>) {
  return Object.entries(vars)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join('\n')
    .concat('\n');
}
