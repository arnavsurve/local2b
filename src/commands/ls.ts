import type { Command } from '../context';

export const ls: Command = async ({ ctx }) => {
  const searched = ctx.providers.filter((p) =>
    ctx.flag ? p.id === ctx.flag : ctx.configured.includes(p.id)
  );
  const results = await Promise.all(
    searched.map(async (provider) => {
      try {
        return { provider, boxes: await provider.list(), error: null };
      } catch (err) {
        return { provider, boxes: [], error: err instanceof Error ? err.message : String(err) };
      }
    })
  );
  for (const { provider, boxes, error } of results) {
    if (error) console.error(`l2b: could not list ${provider.id}: ${error}`);
    for (const box of boxes) {
      console.log([box.name, box.state, box.id, box.image, provider.id].join('\t'));
    }
  }
};
