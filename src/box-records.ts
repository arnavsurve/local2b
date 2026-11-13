import { mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const PRUNE_AFTER_MS = 3 * 24 * 3_600_000;

const boxRecordSchema = z.object({
  provider: z.string(),
  name: z.string(),
  repo: z.string().nullable(),
  branch: z.string().nullable(),
  idleMinutes: z.number(),
  startedAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
});

export type BoxRecord = z.infer<typeof boxRecordSchema>;

const recordsSchema = z.record(z.string(), boxRecordSchema);

function recordsPath() {
  const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return join(stateHome, 'l2b', 'boxes.json');
}

const key = ({ provider, name }: { provider: string; name: string }) => `${provider}:${name}`;

async function readRecords() {
  const file = Bun.file(recordsPath());
  if (!(await file.exists())) return {};
  const parsed = recordsSchema.safeParse(await file.json().catch(() => null));
  return parsed.success ? parsed.data : {};
}

async function writeRecords({ records, now }: { records: Record<string, BoxRecord>; now: Date }) {
  const kept = Object.fromEntries(
    Object.entries(records).filter(([, r]) => now.getTime() - new Date(r.lastUsedAt).getTime() < PRUNE_AFTER_MS)
  );
  const path = recordsPath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await Bun.write(tmp, JSON.stringify(kept, null, 2));
  await rename(tmp, path);
}

/** Notes a box l2b started, so a later lookup can tell "expired" from "never existed". */
export async function recordBoxStart({
  provider,
  name,
  repo,
  branch,
  idleMinutes,
  at,
}: {
  provider: string;
  name: string;
  repo: string | null;
  branch: string | null;
  idleMinutes: number;
  at: Date;
}) {
  const records = await readRecords();
  const iso = at.toISOString();
  records[key({ provider, name })] = { provider, name, repo, branch, idleMinutes, startedAt: iso, lastUsedAt: iso };
  await writeRecords({ records, now: new Date() });
}

const touched = new Set<string>();

/** Moves a recorded box's last-used time to `at`. Boxes l2b did not start are ignored. */
export async function touchBox({ provider, name, at }: { provider: string; name: string; at: Date }) {
  touched.add(key({ provider, name }));
  const records = await readRecords();
  const record = records[key({ provider, name })];
  if (!record) return;
  record.lastUsedAt = at.toISOString();
  await writeRecords({ records, now: at });
}

/** Touches every box this process connected to again, so a long command counts as activity up to its end. */
export async function touchConnectedBoxes({ at }: { at: Date }) {
  if (touched.size === 0) return;
  const records = await readRecords();
  let changed = false;
  for (const k of touched) {
    const record = records[k];
    if (!record) continue;
    record.lastUsedAt = at.toISOString();
    changed = true;
  }
  if (changed) await writeRecords({ records, now: at });
}

export async function forgetBox({ provider, name }: { provider: string; name: string }) {
  const records = await readRecords();
  if (!records[key({ provider, name })]) return;
  delete records[key({ provider, name })];
  await writeRecords({ records, now: new Date() });
}

/** The most recently used record for `name`, limited to `providers` when given. */
export async function readBoxRecord({ name, providers }: { name: string; providers?: string[] }) {
  const matches = Object.values(await readRecords())
    .filter((r) => r.name === name && (!providers || providers.includes(r.provider)))
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  return matches[0] ?? null;
}

function clockTime({ at, now }: { at: Date; now: Date }) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (at.toDateString() === now.toDateString()) return time;
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${time}`;
}

/** The one-line explanation for a recorded box that no longer exists. */
export function expiredMessage({ record, now }: { record: BoxRecord; now: Date }) {
  const restart = [
    `l2b up ${record.name}`,
    ...(record.repo ? [`--repo ${record.repo}`] : []),
    ...(record.branch ? [`--branch ${record.branch}`] : []),
  ].join(' ');
  const since = clockTime({ at: new Date(record.lastUsedAt), now });
  return `box "${record.name}" expired: no l2b activity for ${record.idleMinutes} min since ${since} (idle.minutes in the l2b config). Start it again: ${restart}`;
}
