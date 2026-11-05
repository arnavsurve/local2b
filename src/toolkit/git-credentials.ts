import type { GitCredentials } from '../providers/types';
import { shellQuote } from '../shell';

/** Scoped to the host's origin so the token is never offered to other remotes. */
export function credentialHelperCommand(host: GitCredentials) {
  const origin = new URL(host.baseUrl).origin;
  const helper = `!f() { echo username=${host.username}; echo password=$${host.tokenEnvVar}; }; f`;
  return `git config --global ${shellQuote(`credential.${origin}.helper`)} ${shellQuote(helper)}`;
}
