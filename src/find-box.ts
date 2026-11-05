import type { Context } from './context';
import { ProviderAuthError, type Provider } from './providers/types';

type Probe =
  | { provider: Provider; outcome: 'found' }
  | { provider: Provider; outcome: 'absent' }
  | { provider: Provider; outcome: 'skipped'; error: ProviderAuthError };

async function probe({ provider, name }: { provider: Provider; name: string }): Promise<Probe> {
  try {
    const found = await provider.exists({ name });
    return { provider, outcome: found ? 'found' : 'absent' };
  } catch (err) {
    if (err instanceof ProviderAuthError) return { provider, outcome: 'skipped', error: err };
    throw err;
  }
}

/**
 * The provider that holds the box called `name`. `--provider` wins outright.
 * Otherwise every configured provider is asked at once: one match is used,
 * several is an error, and a provider without credentials is skipped.
 */
export async function findBoxProvider({ ctx, name }: { ctx: Context; name: string }) {
  if (ctx.flag) {
    const chosen = ctx.providers.find((p) => p.id === ctx.flag);
    if (!chosen) throw new Error(`unknown provider "${ctx.flag}" (known: ${ctx.providers.map((p) => p.id).join(', ')})`);
    return chosen;
  }

  const searched = ctx.providers.filter((p) => ctx.configured.includes(p.id));
  const probes = await Promise.all(searched.map((provider) => probe({ provider, name })));
  const found = probes.filter((p) => p.outcome === 'found');
  const [first, second] = found;
  if (first && second) {
    const ids = found.map((p) => p.provider.id);
    throw new Error(
      `a sandbox named "${name}" exists on ${ids.join(' and ')}; pass --provider <${ids.join('|')}> to pick one`
    );
  }
  if (first) return first.provider;

  const skipped = probes.flatMap((p) => (p.outcome === 'skipped' ? [p] : []));
  const [firstSkipped] = skipped;
  if (firstSkipped && skipped.length === probes.length) throw firstSkipped.error;
  const note = skipped.length ? `; skipped, cannot authenticate: ${skipped.map((p) => p.provider.id).join(', ')}` : '';
  throw new Error(`no sandbox named "${name}" (try: l2b ls)${note}`);
}

export async function connectBox({ ctx, name }: { ctx: Context; name: string }) {
  return (await findBoxProvider({ ctx, name })).connect({ name });
}
