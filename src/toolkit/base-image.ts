import { createHash } from 'node:crypto';
import { z } from 'zod';
import { acquireLock, lockHolder, releaseLock } from '../lock';
import { step } from '../progress';
import { statePath, stateSlug, writeJsonAtomic } from '../state';
import type { MachineHost } from './machine';

const WAIT_POLL_MS = 2_000;

const recordsSchema = z.record(z.string(), z.string());
const recordsPath = () => statePath('images.json');
const key = ({ host }: { host: MachineHost }) => `${host.id}:${host.defaultImage}`;

async function readRecords() {
  const file = Bun.file(recordsPath());
  if (!(await file.exists())) return {};
  const parsed = recordsSchema.safeParse(await file.json().catch(() => null));
  return parsed.success ? parsed.data : {};
}

async function recordedRecipe({ host }: { host: MachineHost }) {
  return (await readRecords())[key({ host })] ?? null;
}

async function recordRecipe({ host, hash }: { host: MachineHost; hash: string }) {
  const records = await readRecords();
  records[key({ host })] = hash;
  await writeJsonAtomic({ path: recordsPath(), value: records });
}

const recipeHash = (recipe: string) => createHash('sha256').update(recipe).digest('hex');

/** Builds the base image and notes the recipe it was built from. */
export async function buildBaseImage({ host }: { host: MachineHost }) {
  const ref = await host.buildImage();
  const recipe = host.imageRecipe();
  if (recipe !== null) await recordRecipe({ host, hash: recipeHash(recipe) });
  return ref;
}

/**
 * Whether the base image this machine last saw built or in use matches the
 * host's current recipe. Local only: it makes no call to the host.
 */
export async function baseImageCurrent({ host }: { host: MachineHost }) {
  const recipe = host.imageRecipe();
  return recipe === null || (await recordedRecipe({ host })) === recipeHash(recipe);
}

/**
 * Makes sure the host's base image exists and matches its recipe, building
 * it when it is missing or was built from another recipe. One process builds
 * at a time; others wait for it. An image already on the host that this
 * machine has no record of is taken as current, so a shared image is not
 * rebuilt just because a new machine starts using it.
 */
export async function ensureBaseImage({ host }: { host: MachineHost }) {
  const recipe = host.imageRecipe();
  if (recipe === null) return;
  const hash = recipeHash(recipe);
  const lock = { name: `image-${stateSlug({ provider: host.id, repo: host.defaultImage })}` };
  for (;;) {
    const recorded = await recordedRecipe({ host });
    const exists = await host.imageExists();
    if (exists && recorded === hash) return;
    if (exists && recorded === null) {
      console.error(`l2b: using the existing base image ${host.defaultImage}; it is rebuilt when the image settings change`);
      await recordRecipe({ host, hash });
      return;
    }
    const held = await acquireLock({ ...lock, pid: process.pid, log: null });
    if (!held.acquired) {
      step(`waiting for another l2b process (pid ${held.holder.pid}) to prepare the base image ${host.defaultImage}`);
      while (await lockHolder(lock)) await Bun.sleep(WAIT_POLL_MS);
      continue;
    }
    try {
      if ((await recordedRecipe({ host })) === hash && (await host.imageExists())) return;
      step(`preparing the base image ${host.defaultImage} (${exists ? 'image settings changed' : 'first use'}; several minutes, once)`);
      await buildBaseImage({ host });
      return;
    } finally {
      await releaseLock({ ...lock, token: held.token });
    }
  }
}
