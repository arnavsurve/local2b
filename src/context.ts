import { loadConfig, type Config } from './config';
import { createProvider, PROVIDER_IDS, type ProviderId } from './providers';
import { resolveValue } from './secrets';
import { resolveProviderId } from './providers/select';
import { COMPILED } from './runtime';
import type { Provider } from './providers/types';

export type Context = {
  config: Config;
  /** The provider selected for commands that create or bake. */
  provider: Provider;
  /** Every provider l2b can talk to. */
  providers: Provider[];
  /** Ids of the providers searched when a command addresses a box by name. */
  configured: string[];
  /** The provider used when nothing else picks one. */
  defaultId: string;
  /** `--provider`, when given. */
  flag: string | null;
  /** `L2B_PROVIDER`, when set. */
  env: string | null;
  /** Where `.l2b.json` and the local checkout are looked up from. */
  cwd: string;
  /** The argv that runs this l2b again, for work it hands to a background process. */
  l2b: string[];
};

function providerFor({
  providers,
  id,
}: {
  providers: Provider[];
  id: string;
}) {
  const provider = providers.find((p) => p.id === id);
  if (!provider) throw new Error(`provider ${id} is not available`);
  return provider;
}

export function buildContext(opts: Omit<Context, 'provider'>): Context {
  return selectForRepo({
    ctx: { ...opts, provider: providerFor({ providers: opts.providers, id: opts.defaultId }) },
    repo: null,
  });
}

/** Re-selects the provider once the command knows its repo, which can override the default. */
export function selectForRepo({ ctx, repo }: { ctx: Context; repo: string | null }): Context {
  const id = resolveProviderId({
    flag: ctx.flag,
    env: ctx.env,
    repoOverride: repo ? (ctx.config.repos[repo]?.provider ?? null) : null,
    configDefault: ctx.defaultId,
    knownIds: ctx.providers.map((p) => p.id),
  });
  return { ...ctx, provider: providerFor({ providers: ctx.providers, id }) };
}

/**
 * Providers searched by name and listed by `ls`: those with a config block,
 * the default, and any whose API key reference resolves in `env`. The key
 * itself is discarded.
 */
export async function configuredProviders({
  config,
  env,
}: {
  config: Config;
  env: Record<string, string | undefined>;
}): Promise<ProviderId[]> {
  const keyed = await Promise.all(
    PROVIDER_IDS.map(async (id) => {
      if (config.declaredProviders.includes(id)) return true;
      return resolveValue(config[id].apiKey, { env }).then(
        () => true,
        () => false
      );
    })
  );
  return PROVIDER_IDS.filter((_, i) => keyed[i]);
}

export async function createContext({ flag }: { flag: string | null }) {
  const config = await loadConfig();
  return buildContext({
    config,
    providers: PROVIDER_IDS.map((id) => createProvider({ id, config })),
    configured: await configuredProviders({ config, env: process.env }),
    defaultId: config.provider,
    flag,
    env: process.env.L2B_PROVIDER || null,
    cwd: process.cwd(),
    l2b: COMPILED ? [process.execPath] : [process.execPath, Bun.main],
  });
}

export type Command = (opts: { ctx: Context; args: string[] }) => Promise<void>;
