import { test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sandbox } from 'e2b';
import { loadConfig } from '../../config';
import { resolveGitHost, resolveHostToken } from '../../git-host';
import { resolveValue } from '../../secrets';
import { snapshotName } from '../../toolkit/layout';
import { describeProviderContract, type ContractSubject } from '../contract';
import type { ExecOutput } from '../types';
import { snapshotHasName } from './snapshot-match';
import { createE2bProvider } from './provider';

/**
 * Runs the provider contract against real e2b boxes. Opt in with
 * L2B_CONTRACT_E2B=1; it needs an e2b API key and a GitHub token, creates
 * boxes and one snapshot, and takes several minutes.
 * L2B_CONTRACT_E2B_REPO and L2B_CONTRACT_E2B_BRANCH pick the public repo.
 */
const ENABLED = process.env.L2B_CONTRACT_E2B === '1';
const IDLE_MINUTES = 1;
const PROBE_VAR = 'L2B_CONTRACT_PROBE';

async function e2bSubject(): Promise<ContractSubject> {
  const stateDir = mkdtempSync(join(tmpdir(), 'l2b-contract-state-'));
  process.env.XDG_STATE_HOME = stateDir;
  const config = await loadConfig();
  const provider = createE2bProvider({
    config: config.e2b,
    idle: { ms: IDLE_MINUTES * 60_000, action: 'kill' },
  });
  const [owner = '', name = ''] = (process.env.L2B_CONTRACT_E2B_REPO ?? 'octocat/Hello-World').split('/');
  const host = resolveGitHost({ type: 'github', baseUrl: 'https://github.com' });
  const token = await resolveHostToken(host);
  /** Its own owner, so the contract's snapshot never replaces a real bake of the same repo. */
  const repo = {
    owner: 'l2b-contract',
    name: name.toLowerCase(),
    remoteUrl: `https://github.com/${owner}/${name}.git`,
    baseBranch: null,
    clone: { strategy: 'mirror' as const, depth: 50, filter: 'blob:limit=50m' },
    setup: [],
    install: null,
    warm: null,
    env: {},
  };
  const credentials = {
    variables: { [host.tokenEnvVar]: token },
    git: { baseUrl: host.baseUrl, username: host.username, tokenEnvVar: host.tokenEnvVar },
  };

  return {
    provider,
    repo,
    branch: process.env.L2B_CONTRACT_E2B_BRANCH ?? 'octocat-patch-1',
    credentials,
    idle: { minutes: IDLE_MINUTES },
    passIdleTime: () => Bun.sleep(IDLE_MINUTES * 60_000 + 60_000),
    async findPersisted({ value }) {
      const found: string[] = [];
      const records = Bun.file(join(stateDir, 'l2b', 'bakes.json'));
      if ((await records.exists()) && (await records.text()).includes(value)) found.push('bakes.json');
      const probe = await provider.start({
        name: `contract-probe-${Date.now()}`,
        repo,
        branch: null,
        source: 'bake',
        image: null,
        idle: { minutes: IDLE_MINUTES },
        credentials: { ...credentials, variables: { ...credentials.variables, [PROBE_VAR]: value } },
        gitIdentity: null,
      });
      try {
        let out = '';
        await probe.exec({
          cmd: `grep -rlF -e "$${PROBE_VAR}" "$HOME" /tmp /etc /opt /var/tmp 2>/dev/null || true`,
          cwd: null,
          onOutput: ({ stream, data }: ExecOutput) => {
            if (stream === 'stdout') out += data;
          },
        });
        found.push(...out.split('\n').filter(Boolean));
      } finally {
        await probe.destroy();
      }
      return found;
    },
    unsupported: [],
    async cleanup() {
      const apiKey = await resolveValue(config.e2b.apiKey);
      const paginator = Sandbox.listSnapshots({ apiKey });
      do {
        for (const snapshot of await paginator.nextItems()) {
          if (snapshotHasName({ names: snapshot.names, name: snapshotName(`${repo.owner}/${repo.name}`) })) {
            await Sandbox.deleteSnapshot(snapshot.snapshotId, { apiKey });
          }
        }
      } while (paginator.hasNext);
      delete process.env.XDG_STATE_HOME;
      rmSync(stateDir, { recursive: true, force: true });
    },
  };
}

if (ENABLED) {
  describeProviderContract({ name: 'e2b', makeProvider: e2bSubject, timeoutMs: 20 * 60_000 });
} else {
  test.skip('provider contract: e2b (set L2B_CONTRACT_E2B=1 to run against real boxes)', () => {});
}
