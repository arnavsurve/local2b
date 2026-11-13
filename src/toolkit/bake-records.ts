import { z } from 'zod';
import { statePath, writeJsonAtomic } from '../state';
import { snapshotName } from './layout';
import type { MachineHost } from './machine';

/**
 * The base image build a bake was made on. `own-image`: it was made from an
 * image the user picked, not the base image. `unrecorded`: the bake predates
 * l2b noting its base.
 */
export type BakeBase = { kind: 'base'; ref: string } | { kind: 'own-image' } | { kind: 'unrecorded' };

type BakeRecord = { at: string; base: BakeBase };

/** Older records hold only the time, as a string. A stored base of null means the bake used its own image. */
const recordSchema = z.union([
  z.iso.datetime().transform((at): BakeRecord => ({ at, base: { kind: 'unrecorded' } })),
  z.object({ at: z.iso.datetime(), base: z.string().nullable() }).transform(
    ({ at, base }): BakeRecord => ({ at, base: base === null ? { kind: 'own-image' } : { kind: 'base', ref: base } })
  ),
]);
const recordsSchema = z.record(z.string(), recordSchema);

function stored({ at, base }: BakeRecord) {
  switch (base.kind) {
    case 'unrecorded':
      return at;
    case 'own-image':
      return { at, base: null };
    case 'base':
      return { at, base: base.ref };
    default: {
      const unreachable: never = base;
      return unreachable;
    }
  }
}

const bakeTimesPath = () => statePath('bakes.json');

async function readRecords(): Promise<Record<string, BakeRecord>> {
  const file = Bun.file(bakeTimesPath());
  if (!(await file.exists())) return {};
  const parsed = recordsSchema.safeParse(await file.json().catch(() => null));
  return parsed.success ? parsed.data : {};
}

/** Replaced in one rename: a new record appears only once the bake is complete, and never half-written. */
async function writeRecords(records: Record<string, BakeRecord>) {
  const value = Object.fromEntries(Object.entries(records).map(([key, record]) => [key, stored(record)]));
  await writeJsonAtomic({ path: bakeTimesPath(), value });
}

const bakeKey = ({ provider, repo }: { provider: string; repo: string }) => `${provider}:${repo}`;

/**
 * Notes when `repo` was baked and on which base image build (`base`, an
 * opaque reference; null when the bake used an image the user picked). Not
 * every provider reports a snapshot's creation time (e2b does not), so the
 * age comes from this local record.
 */
export async function recordBake({
  provider,
  repo,
  at,
  base,
}: {
  provider: string;
  repo: string;
  at: Date;
  base: string | null;
}) {
  const records = await readRecords();
  records[bakeKey({ provider, repo })] = {
    at: at.toISOString(),
    base: base === null ? { kind: 'own-image' } : { kind: 'base', ref: base },
  };
  await writeRecords(records);
}

/** Drops the record of when `repo` was baked on `provider`. */
export async function forgetBake({ provider, repo }: { provider: string; repo: string }) {
  const records = await readRecords();
  if (!Object.hasOwn(records, bakeKey({ provider, repo }))) return;
  delete records[bakeKey({ provider, repo })];
  await writeRecords(records);
}

/** The repos this machine baked on `provider`, with when. */
export async function recordedBakes({ provider }: { provider: string }) {
  const prefix = `${provider}:`;
  return Object.entries(await readRecords()).flatMap(([key, record]) =>
    key.startsWith(prefix) ? [{ repo: key.slice(prefix.length), at: new Date(record.at) }] : []
  );
}

/**
 * The repo's snapshot, or null. `createdAt` is null when the provider can't
 * say and no local bake record exists (e.g. baked from another machine).
 * `base` is null when there is no local record of the bake.
 */
export async function lookupSnapshot({ provider, repo }: { provider: MachineHost; repo: string }) {
  const found = await provider.findSnapshot({ name: snapshotName(repo) });
  if (!found) return null;
  const recorded = (await readRecords())[bakeKey({ provider: provider.id, repo })] ?? null;
  return {
    id: found.id,
    createdAt: found.createdAt ?? (recorded ? new Date(recorded.at) : null),
    base: recorded?.base ?? null,
  };
}
