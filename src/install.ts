import type { Box } from './providers/types';

export type DetectedInstall = { command: string; reason: string };

/**
 * Picks an install command from the file names in a checkout root. Only the JS
 * ecosystem is covered; anything else returns null so the user sets `install`
 * rather than l2b guessing at tools the image may not have.
 */
export function detectInstall({ files }: { files: string[] }): DetectedInstall | null {
  const has = (name: string) => files.includes(name);
  if (has('bun.lock')) return { command: 'bun install --frozen-lockfile', reason: 'bun.lock' };
  if (has('bun.lockb')) return { command: 'bun install --frozen-lockfile', reason: 'bun.lockb' };
  if (has('pnpm-lock.yaml')) {
    return { command: 'pnpm install --frozen-lockfile', reason: 'pnpm-lock.yaml' };
  }
  if (has('yarn.lock')) {
    return has('.yarnrc.yml')
      ? { command: 'yarn install --immutable', reason: 'yarn.lock' }
      : { command: 'yarn install --frozen-lockfile', reason: 'yarn.lock' };
  }
  if (has('package-lock.json')) return { command: 'npm ci', reason: 'package-lock.json' };
  if (has('package.json')) return { command: 'npm install', reason: 'package.json' };
  return null;
}

/** Lists the checkout root by running a real `ls -A` in the box. */
export async function listRoot({ box, dir }: { box: Box; dir: string }) {
  let out = '';
  const exitCode = await box.exec({
    cmd: 'ls -A',
    cwd: dir,
    onOutput: ({ stream, data }) => {
      if (stream === 'stdout') out += data;
    },
  });
  if (exitCode !== 0) throw new Error(`listing ${dir} failed (exit ${exitCode})`);
  return out.split('\n').filter((name) => name !== '');
}

/** A configured string wins; only `null` triggers detection from the checkout. */
export async function resolveInstall({
  box,
  dir,
  configured,
}: {
  box: Box;
  dir: string;
  configured: string | null;
}): Promise<DetectedInstall | null> {
  if (configured !== null) return { command: configured, reason: 'configured' };
  return detectInstall({ files: await listRoot({ box, dir }) });
}

export function describeInstall({ install }: { install: DetectedInstall | null }) {
  if (!install) {
    return 'no install command detected, skipping (set repos.<o/r>.install for other ecosystems)';
  }
  const detected = install.reason === 'configured' ? '' : ` (detected ${install.reason})`;
  return `installing dependencies${detected}: ${install.command}`;
}
