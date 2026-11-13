import { createHash } from 'node:crypto';
import { z } from 'zod';
import { acquireLock, lockHolder, releaseLock } from '../lock';
import { step } from '../progress';
import { statePath, stateSlug, writeJsonAtomic } from '../state';
import type { MachineHost } from './machine';

const WAIT_POLL_MS = 500;

/** Older records hold only the recipe digest, as a string. */
const recordSchema = z.union([
  z.string().transform((recipe) => ({ recipe, ref: null })),
  z.object({ recipe: z.string(), ref: z.string() }),
]);
const recordsSchema = z.record(z.string(), recordSchema);
type ImageRecord = { recipe: string; ref: string | null };

const recordsPath = () => statePath('images.json');
const key = ({ host }: { host: MachineHost }) => `${host.id}:${host.defaultImage}`;

async function readRecords(): Promise<Record<string, ImageRecord>> {
  const file = Bun.file(recordsPath());
  if (!(await file.exists())) return {};
  const parsed = recordsSchema.safeParse(await file.json().catch(() => null));
  return parsed.success ? parsed.data : {};
}

async function readRecord({ host }: { host: MachineHost }) {
  return (await readRecords())[key({ host })] ?? null;
}

async function recordImage({ host, recipe, ref }: { host: MachineHost; recipe: string; ref: string }) {
  const records = await readRecords();
  records[key({ host })] = { recipe, ref };
  await writeJsonAtomic({ path: recordsPath(), value: records });
}

const recipeHash = (recipe: string) => createHash('sha256').update(recipe).digest('hex');

/** Builds the base image, notes the recipe and the build, and returns that build's reference. */
export async function buildBaseImage({ host }: { host: MachineHost }) {
  const ref = await host.buildImage();
  const recipe = host.imageRecipe();
  if (recipe !== null) await recordImage({ host, recipe: recipeHash(recipe), ref });
  return ref;
}

/** The recorded build when it was made from `hash` and is still on the host. */
async function recordedBuild({ host, hash }: { host: MachineHost; hash: string }) {
  const record = await readRecord({ host });
  if (record?.recipe !== hash || record.ref === null) return null;
  return (await host.imageExists({ ref: record.ref })) ? record.ref : null;
}

/**
 * Whether the base image this machine last saw built or in use matches the
 * host's current recipe. Local only: it makes no call to the host.
 */
export async function baseImageCurrent({ host }: { host: MachineHost }) {
  const recipe = host.imageRecipe();
  return recipe === null || (await readRecord({ host }))?.recipe === recipeHash(recipe);
}

/**
 * The build of the base image this machine last prepared or confirmed for
 * the current recipe, or null when it has none. Local only.
 */
export async function currentBaseBuild({ host }: { host: MachineHost }) {
  const recipe = host.imageRecipe();
  if (recipe === null) return null;
  const record = await readRecord({ host });
  return record?.recipe === recipeHash(recipe) ? record.ref : null;
}

/**
 * Makes sure the host's base image exists and matches its recipe, building
 * it when it is missing or was built from another recipe, and returns the
 * reference of the exact build to create machines from. Anything but the
 * fast path holds a local lock, so one process builds at a time and the
 * others wait for it rather than judge an image that is still building. An
 * image already on the host that this machine has no record of is taken as
 * current, so a shared image is not rebuilt just because a new machine starts
 * using it.
 */
export async function ensureBaseImage({ host }: { host: MachineHost }): Promise<string> {
  const recipe = host.imageRecipe();
  if (recipe === null) return host.defaultImage;
  const hash = recipeHash(recipe);
  const ready = await recordedBuild({ host, hash });
  if (ready !== null) return ready;
  const lock = { name: `image-${stateSlug({ provider: host.id, repo: host.defaultImage })}` };
  for (;;) {
    const held = await acquireLock({ ...lock, pid: process.pid, log: null });
    if (!held.acquired) {
      step(`waiting for another l2b process (pid ${held.holder.pid}) to prepare the base image ${host.defaultImage}`);
      while (await lockHolder(lock)) await Bun.sleep(WAIT_POLL_MS);
      continue;
    }
    try {
      const built = await recordedBuild({ host, hash });
      if (built !== null) return built;
      const record = await readRecord({ host });
      const current = await host.currentImage();
      if (current !== null && (record === null || record.recipe === hash)) {
        if (record === null) {
          console.error(`l2b: using the existing base image ${host.defaultImage}; it is rebuilt when the image settings change`);
        }
        await recordImage({ host, recipe: hash, ref: current });
        return current;
      }
      step(`preparing the base image ${host.defaultImage} (${current !== null ? 'image settings changed' : 'first use'}; several minutes, once)`);
      return await buildBaseImage({ host });
    } finally {
      await releaseLock({ ...lock, token: held.token });
    }
  }
}
