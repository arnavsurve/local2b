import { z } from 'zod';
import { statePath, writeJsonAtomic } from '../state';
import { snapshotName } from './layout';
import type { MachineHost } from './machine';

const bakeTimesSchema = z.record(z.string(), z.iso.datetime());

const bakeTimesPath = () => statePath('bakes.json');

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
  await writeBakeTimes(times);
}

/** Replaced in one rename: the new bake time appears only once the bake is complete, and never half-written. */
async function writeBakeTimes(times: Record<string, string>) {
  await writeJsonAtomic({ path: bakeTimesPath(), value: times });
}

/** Drops the record of when `repo` was baked on `provider`. */
export async function forgetBake({ provider, repo }: { provider: string; repo: string }) {
  const times = await readBakeTimes();
  if (!Object.hasOwn(times, bakeKey({ provider, repo }))) return;
  delete times[bakeKey({ provider, repo })];
  await writeBakeTimes(times);
}

/** The repos this machine baked on `provider`, with when. */
export async function recordedBakes({ provider }: { provider: string }) {
  const prefix = `${provider}:`;
  return Object.entries(await readBakeTimes()).flatMap(([key, at]) =>
    key.startsWith(prefix) ? [{ repo: key.slice(prefix.length), at: new Date(at) }] : []
  );
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
