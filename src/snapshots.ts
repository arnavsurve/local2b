import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { snapshotName } from './repo';
import type { MachineHost } from './toolkit/machine';

const bakeTimesSchema = z.record(z.string(), z.iso.datetime());

function bakeTimesPath() {
  const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return join(stateHome, 'l2b', 'bakes.json');
}

async function readBakeTimes() {
  const file = Bun.file(bakeTimesPath());
  if (!(await file.exists())) return {};
  const parsed = bakeTimesSchema.safeParse(await file.json());
  return parsed.success ? parsed.data : {};
}

const bakeKey = ({ provider, repo }: { provider: string; repo: string }) => `${provider}:${repo}`;

/**
 * Notes when `repo` was baked. Not every provider reports a snapshot's
 * creation time (e2b does not), so the age comes from this local record.
 */
export async function recordBake({
  provider,
  repo,
  at,
}: {
  provider: string;
  repo: string;
  at: Date;
}) {
  const times = await readBakeTimes();
  times[bakeKey({ provider, repo })] = at.toISOString();
  const path = bakeTimesPath();
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(times, null, 2));
}

/**
 * The repo's snapshot, or null. `createdAt` is null when the provider can't
 * say and no local bake record exists (e.g. baked from another machine).
 */
export async function lookupSnapshot({ provider, repo }: { provider: MachineHost; repo: string }) {
  const found = await provider.findSnapshot({ name: snapshotName(repo) });
  if (!found) return null;
  if (found.createdAt) return found;
  const recorded = (await readBakeTimes())[bakeKey({ provider: provider.id, repo })];
  return { id: found.id, createdAt: recorded ? new Date(recorded) : null };
}

/** One-line advice for a snapshot older than the threshold, or null. */
export function staleSnapshotHint({
  repo,
  createdAt,
  now,
  thresholdHours,
}: {
  repo: string;
  createdAt: Date | null;
  now: Date;
  thresholdHours: number;
}) {
  if (!createdAt) return null;
  const ageHours = (now.getTime() - createdAt.getTime()) / 3_600_000;
  if (ageHours <= thresholdHours) return null;
  return `snapshot for ${repo} is ${formatAge({ hours: ageHours })} old, so up is slower than it needs to be; re-bake with: l2b bake ${repo}`;
}

export function formatAge({ hours }: { hours: number }) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}
