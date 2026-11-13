import type { Command } from '../context';
import { formatAge } from '../snapshots';

/**
 * Bakes on every configured provider, or on `--provider`'s: repo (or the
 * bake's own name when the repo is unknown), provider, id and age. A provider
 * that fails prints one warning on stderr and the rest still list.
 */
export const bakes: Command = async ({ ctx }) => {
  const searched = ctx.providers.filter((p) => (ctx.flag ? p.id === ctx.flag : ctx.configured.includes(p.id)));
  const results = await Promise.all(
    searched.map(async (provider) => {
      try {
        return { provider, bakes: await provider.bakes(), error: null };
      } catch (err) {
        return { provider, bakes: [], error: err instanceof Error ? err.message : String(err) };
      }
    })
  );
  const now = Date.now();
  for (const { provider, bakes, error } of results) {
    if (error) console.error(`l2b: could not list bakes on ${provider.id}: ${error}`);
    for (const bake of bakes) {
      const age = bake.createdAt ? formatAge({ hours: (now - bake.createdAt.getTime()) / 3_600_000 }) : '-';
      console.log([bake.repo ?? bake.name, provider.id, bake.id, age].join('\t'));
    }
  }
};
