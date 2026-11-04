import { $ } from 'bun';
import { z } from 'zod';
import type { Config } from './config';
import { resolveValue, valueRefSchema } from './secrets';
import { shellQuote } from './shell';

/** Where a repo's git remote lives and how to authenticate to it. */
export const gitHostSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('github') }),
  z.object({
    type: z.literal('gitlab'),
    baseUrl: z.string().default('https://gitlab.com'),
  }),
  /** Any other https git host (Bitbucket, Gitea, self-hosted): a fixed username plus a token. */
  z.object({
    type: z.literal('generic'),
    baseUrl: z.string(),
    username: z.string(),
    token: valueRefSchema,
  }),
]);
export type GitHost = z.infer<typeof gitHostSchema>;

export const GITHUB_BASE_URL = 'https://github.com';

function baseUrlOf(host: GitHost) {
  switch (host.type) {
    case 'github':
      return GITHUB_BASE_URL;
    case 'gitlab':
    case 'generic':
      return host.baseUrl.replace(/\/+$/, '');
    default: {
      const unreachable: never = host;
      throw new Error(`unknown git host: ${JSON.stringify(unreachable)}`);
    }
  }
}

export function remoteUrl({ host, repo }: { host: GitHost; repo: string }) {
  return `${baseUrlOf(host)}/${repo}.git`;
}

export function credentialUsername(host: GitHost) {
  switch (host.type) {
    case 'github':
      return 'x-access-token';
    case 'gitlab':
      return 'oauth2';
    case 'generic':
      return host.username;
    default: {
      const unreachable: never = host;
      throw new Error(`unknown git host: ${JSON.stringify(unreachable)}`);
    }
  }
}

/** The variable the token is exported as inside the sandbox. */
export function tokenEnvVar(host: GitHost) {
  switch (host.type) {
    case 'github':
      return 'GH_TOKEN';
    case 'gitlab':
      return 'GITLAB_TOKEN';
    case 'generic':
      return 'L2B_GIT_TOKEN';
    default: {
      const unreachable: never = host;
      throw new Error(`unknown git host: ${JSON.stringify(unreachable)}`);
    }
  }
}

/** Scoped to the host's origin so the token is never offered to other remotes. */
export function credentialHelperCommand(host: GitHost) {
  const origin = new URL(baseUrlOf(host)).origin;
  const helper = `!f() { echo username=${credentialUsername(host)}; echo password=$${tokenEnvVar(host)}; }; f`;
  return `git config --global ${shellQuote(`credential.${origin}.helper`)} ${shellQuote(helper)}`;
}

async function cliToken({ cmd, hint }: { cmd: string[]; hint: string }) {
  const out = await $`${cmd}`.nothrow().quiet();
  if (out.exitCode !== 0) throw new Error(hint);
  return out.text().trim();
}

export async function resolveHostToken(host: GitHost) {
  switch (host.type) {
    case 'github': {
      const fromEnv = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
      if (fromEnv) return fromEnv;
      return cliToken({
        cmd: ['gh', 'auth', 'token'],
        hint: 'no GitHub token: set GH_TOKEN or run `gh auth login`',
      });
    }
    case 'gitlab': {
      const fromEnv = process.env.GITLAB_TOKEN;
      if (fromEnv) return fromEnv;
      return cliToken({
        cmd: ['glab', 'auth', 'token'],
        hint: 'no GitLab token: set GITLAB_TOKEN or run `glab auth login`',
      });
    }
    case 'generic':
      return resolveValue(host.token);
    default: {
      const unreachable: never = host;
      throw new Error(`unknown git host: ${JSON.stringify(unreachable)}`);
    }
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
  return override ?? config.gitHost;
}
