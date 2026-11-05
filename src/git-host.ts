import { z } from 'zod';
import type { Config } from './config';
import { resolveValue, valueRefSchema, type ValueRef } from './secrets';

const DEFAULT_TOKEN_TIMEOUT_MS = 30_000;
const GITHUB_BASE_URL = 'https://github.com';
const GITLAB_BASE_URL = 'https://gitlab.com';

const envNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be a shell variable name');

/**
 * Where a repo's git remote lives and how to authenticate to it.
 * `github` and `gitlab` are presets of the `generic` shape; see `resolveGitHost`.
 */
export const gitHostSchema = z.discriminatedUnion('type', [
  /** `baseUrl` points at a GitHub Enterprise Server instance. */
  z.object({ type: z.literal('github'), baseUrl: z.string().default(GITHUB_BASE_URL) }),
  z.object({ type: z.literal('gitlab'), baseUrl: z.string().default(GITLAB_BASE_URL) }),
  /** Any other https git host (Bitbucket, Gitea, self-hosted): a fixed username plus a token. */
  z.object({
    type: z.literal('generic'),
    baseUrl: z.string(),
    username: z.string(),
    token: valueRefSchema,
    /** The variable the token is exported as inside the sandbox. */
    tokenEnvVar: envNameSchema.default('L2B_GIT_TOKEN'),
  }),
]);
export type GitHost = z.infer<typeof gitHostSchema>;

/** Everything needed to clone from and authenticate to a host. */
export type ResolvedGitHost = {
  baseUrl: string;
  username: string;
  token: ValueRef;
  /** The variable the token is exported as inside the sandbox. */
  tokenEnvVar: string;
  /** Replaces the token chain's own error when it fails. */
  tokenHint: string | null;
};

function trimSlashes(url: string) {
  return url.replace(/\/+$/, '');
}

/** The CLI's `auth token`, scoped to the host unless it is the preset's default one. */
function authTokenArgv({ cli, baseUrl, defaultUrl }: { cli: string; baseUrl: string; defaultUrl: string }) {
  const argv = [cli, 'auth', 'token'];
  if (baseUrl === defaultUrl) return argv;
  return [...argv, '--hostname', new URL(baseUrl).host];
}

function cliCommand(argv: string[]): ValueRef {
  return { from: 'command', argv, timeoutMs: DEFAULT_TOKEN_TIMEOUT_MS };
}

/** The only place that knows what a host type means. */
export function resolveGitHost(host: GitHost): ResolvedGitHost {
  switch (host.type) {
    case 'github': {
      const baseUrl = trimSlashes(host.baseUrl);
      return {
        baseUrl,
        username: 'x-access-token',
        token: {
          from: 'firstOf',
          refs: [
            { from: 'env', name: 'GH_TOKEN' },
            { from: 'env', name: 'GITHUB_TOKEN' },
            cliCommand(authTokenArgv({ cli: 'gh', baseUrl, defaultUrl: GITHUB_BASE_URL })),
          ],
        },
        tokenEnvVar: 'GH_TOKEN',
        tokenHint: 'no GitHub token: set GH_TOKEN or run `gh auth login`',
      };
    }
    case 'gitlab': {
      const baseUrl = trimSlashes(host.baseUrl);
      return {
        baseUrl,
        username: 'oauth2',
        token: {
          from: 'firstOf',
          refs: [
            { from: 'env', name: 'GITLAB_TOKEN' },
            cliCommand(authTokenArgv({ cli: 'glab', baseUrl, defaultUrl: GITLAB_BASE_URL })),
          ],
        },
        tokenEnvVar: 'GITLAB_TOKEN',
        tokenHint: 'no GitLab token: set GITLAB_TOKEN or run `glab auth login`',
      };
    }
    case 'generic':
      return {
        baseUrl: trimSlashes(host.baseUrl),
        username: host.username,
        token: host.token,
        tokenEnvVar: host.tokenEnvVar,
        tokenHint: null,
      };
    default: {
      const unreachable: never = host;
      throw new Error(`unknown git host: ${JSON.stringify(unreachable)}`);
    }
  }
}

export function remoteUrl({ host, repo }: { host: ResolvedGitHost; repo: string }) {
  return `${host.baseUrl}/${repo}.git`;
}

export async function resolveHostToken(host: ResolvedGitHost) {
  try {
    return await resolveValue(host.token);
  } catch (error) {
    if (host.tokenHint) throw new Error(host.tokenHint);
    throw error;
  }
}

/** The repo's own host when configured, else the global one. */
export function hostFor({
  config,
  repo,
}: {
  config: Config;
  repo: string | null;
}) {
  const override = repo ? config.repos[repo]?.gitHost : null;
  return resolveGitHost(override ?? config.gitHost);
}
