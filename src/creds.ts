import { $ } from 'bun';

/**
 * Credentials are resolved on the local machine at call time and pushed into
 * the sandbox's tmpfs (/dev/shm), never baked into a template or written to
 * the sandbox's disk. Pausing a sandbox snapshots memory, so treat sandboxes
 * as holding these secrets while paused.
 */

export async function githubToken() {
  const fromEnv = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (fromEnv) return fromEnv;
  const out = await $`gh auth token`.nothrow().quiet();
  if (out.exitCode !== 0) {
    throw new Error('no GitHub token: set GH_TOKEN or run `gh auth login`');
  }
  return out.text().trim();
}

export type DopplerTarget = { project: string; config: string };

export function parseDopplerTarget(spec: string): DopplerTarget {
  const [project, config] = spec.split('/');
  if (!project || !config) {
    throw new Error(`doppler target must be <project>/<config>, got "${spec}"`);
  }
  return { project, config };
}

export async function dopplerSecrets({ project, config }: DopplerTarget) {
  const out =
    await $`doppler secrets download --no-file --format json --project ${project} --config ${config}`
      .nothrow()
      .quiet();
  if (out.exitCode !== 0) {
    throw new Error(
      `doppler failed for ${project}/${config}: ${out.stderr.toString().trim()}`
    );
  }
  const parsed: Record<string, string> = JSON.parse(out.text());
  return parsed;
}

export function toEnvFile(vars: Record<string, string>) {
  return Object.entries(vars)
    .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
    .join('\n')
    .concat('\n');
}
