import { createHash } from 'node:crypto';
import { chmodSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { Command } from '../context';
import { COMPILED } from '../runtime';
import { VERSION } from '../version';

const LATEST_RELEASE = 'https://api.github.com/repos/arnavsurve/local2b/releases/latest';
const PLATFORMS: Record<string, string> = { darwin: 'darwin', linux: 'linux' };
const ARCHES: Record<string, string> = { arm64: 'arm64', x64: 'x64' };

/** The release asset name for a platform, matching what the release workflow builds. */
export function assetName({ platform, arch }: { platform: string; arch: string }) {
  const os = PLATFORMS[platform];
  const cpu = ARCHES[arch];
  if (!os || !cpu) throw new Error(`no l2b release for ${platform}-${arch}`);
  return `l2b-${os}-${cpu}`;
}

type Release = { tag_name: string; assets: { name: string; browser_download_url: string }[] };

async function download(url: string) {
  const res = await fetch(url, { headers: { 'user-agent': 'l2b' } });
  if (!res.ok) throw new Error(`download failed: ${url} (HTTP ${res.status})`);
  return res;
}

/**
 * Downloads the latest release's asset, checks it against the release's SHA256SUMS, and renames it
 * over `target`. The rename is atomic, so `target` is either the old binary or the new one.
 */
export async function updateBinary({
  releaseUrl,
  target,
  current,
  asset,
}: {
  releaseUrl: string;
  target: string;
  current: string;
  asset: string;
}) {
  const release = (await (await download(releaseUrl)).json()) as Release;
  const version = release.tag_name.replace(/^v/, '');
  if (version === current) return { updated: false, version };

  const urlOf = (name: string) => {
    const found = release.assets.find((a) => a.name === name);
    if (!found) throw new Error(`release ${release.tag_name} has no ${name}`);
    return found.browser_download_url;
  };
  const sums = await (await download(urlOf('SHA256SUMS'))).text();
  const expected = sums
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === asset)?.[0];
  if (!expected) throw new Error(`SHA256SUMS in ${release.tag_name} has no entry for ${asset}`);
  const bytes = new Uint8Array(await (await download(urlOf(asset))).arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`checksum mismatch for ${asset}: expected ${expected}, got ${actual}`);

  const staged = `${target}.update-${process.pid}`;
  try {
    writeFileSync(staged, bytes);
    chmodSync(staged, 0o755);
    renameSync(staged, target);
  } catch (err) {
    rmSync(staged, { force: true });
    throw err;
  }
  return { updated: true, version };
}

/** Replaces the running binary with the latest release, then refreshes the agent skill from it. */
export const update: Command = async () => {
  if (!COMPILED) {
    console.log('l2b is running from a checkout; update it with git pull');
    return;
  }
  const target = process.execPath;
  const asset = assetName({ platform: process.platform, arch: process.arch });
  const { updated, version } = await updateBinary({ releaseUrl: LATEST_RELEASE, target, current: VERSION, asset });
  if (!updated) {
    console.log(`l2b ${VERSION} is the latest release`);
    return;
  }
  console.log(`${target}: ${VERSION} -> ${version}`);
  const proc = Bun.spawn([target, 'install'], { stdout: 'inherit', stderr: 'inherit' });
  if ((await proc.exited) !== 0) throw new Error(`${target} install failed`);
};
