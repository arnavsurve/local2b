/**
 * Picks the provider id for a command that creates or bakes. Precedence:
 * the `--provider` flag, `L2B_PROVIDER`, the repo's `provider` setting, then
 * the config's top-level `provider`.
 */
export function resolveProviderId({
  flag,
  env,
  repoOverride,
  configDefault,
  knownIds,
}: {
  flag: string | null;
  env: string | null;
  repoOverride: string | null;
  configDefault: string;
  knownIds: readonly string[];
}) {
  const id = flag || env || repoOverride || configDefault;
  if (!knownIds.includes(id)) {
    throw new Error(`unknown provider "${id}" (known: ${knownIds.join(', ')})`);
  }
  return id;
}

/**
 * Pulls `--provider <id>` or `--provider=<id>` out of the args, wherever it
 * appears before a `--` separator, so each command's own strict parsing never
 * sees it.
 */
export function extractProviderFlag({ args }: { args: string[] }) {
  const sep = args.indexOf('--');
  const head = sep === -1 ? args : args.slice(0, sep);
  const tail = sep === -1 ? [] : args.slice(sep);
  const rest: string[] = [];
  let providerId: string | null = null;
  for (let i = 0; i < head.length; i++) {
    const arg = head[i] ?? '';
    if (arg === '--provider') {
      const value = head[i + 1];
      if (!value) throw new Error('--provider needs a provider id');
      providerId = value;
      i++;
    } else if (arg.startsWith('--provider=')) {
      providerId = arg.slice('--provider='.length);
      if (!providerId) throw new Error('--provider needs a provider id');
    } else {
      rest.push(arg);
    }
  }
  return { providerId, args: [...rest, ...tail] };
}
