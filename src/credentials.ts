import type { Config } from './config';
import { hostFor, resolveHostToken } from './git-host';
import type { Credentials } from './providers/types';
import { loadSecrets, parseDopplerTarget } from './secrets';

/**
 * Resolves every secret locally, at call time: the configured sources (plus
 * `--doppler`), then the git host token, which wins a name clash. The result
 * is handed to the provider and never stored by l2b.
 */
export async function resolveCredentials({
  config,
  repo,
  doppler,
}: {
  config: Config;
  repo: string | null;
  doppler: string | null;
}): Promise<Credentials> {
  const host = hostFor({ config, repo });
  const sources = [...config.secrets, ...(doppler ? [parseDopplerTarget(doppler)] : [])];
  const variables: Record<string, string> = {};
  for (const source of sources) Object.assign(variables, await loadSecrets(source));
  variables[host.tokenEnvVar] = await resolveHostToken(host);
  return { variables, git: { baseUrl: host.baseUrl, username: host.username, tokenEnvVar: host.tokenEnvVar } };
}
