import { test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../config';
import { resolveGitHost, resolveHostToken } from '../../git-host';
import { snapshotName } from '../../toolkit/layout';
import { describeProviderContract, type ContractSubject } from '../contract';
import type { ExecOutput } from '../types';
import { boatClient } from './api';
import { createBoatProvider } from './provider';
import { bakeFilter, savedSnapshotName } from './requests';

/**
 * Runs the provider contract against real boat boxes. Opt in with
 * L2B_CONTRACT_BOAT=1; it needs a boat API key and a GitHub token, creates
 * small boxes one at a time plus one kept bake box, and takes several minutes.
 * L2B_CONTRACT_BOAT_REPO and L2B_CONTRACT_BOAT_BRANCH pick the public repo.
 */
const ENABLED = process.env.L2B_CONTRACT_BOAT === '1';
const IDLE_MINUTES = 1;
const PROBE_VAR = 'L2B_CONTRACT_PROBE';

async function boatConfig() {
  const config = await loadConfig();
  return { ...config.boat, type: 'small' as const };
}

async function boatSubject(): Promise<ContractSubject> {
  const stateDir = mkdtempSync(join(tmpdir(), 'l2b-contract-state-'));
  process.env.XDG_STATE_HOME = stateDir;
  const config = await boatConfig();
  const provider = createBoatProvider({ config, idle: { ms: IDLE_MINUTES * 60_000 } });
  const [owner = '', name = ''] = (process.env.L2B_CONTRACT_BOAT_REPO ?? 'octocat/Hello-World').split('/');
  const host = resolveGitHost({ type: 'github', baseUrl: 'https://github.com' });
  const token = await resolveHostToken(host);
  /** Its own owner, so the contract's snapshot never replaces a real bake of the same repo. */
  const repo = {
    owner: 'l2b-contract',
    name: name.toLowerCase(),
    remoteUrl: `https://github.com/${owner}/${name}.git`,
    baseBranch: null,
    clone: { strategy: 'mirror' as const, depth: 50, filter: 'blob:limit=50m' },
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
    branch: process.env.L2B_CONTRACT_BOAT_BRANCH ?? 'octocat-patch-1',
    credentials,
    idle: { minutes: IDLE_MINUTES },
    passIdleTime: () => Bun.sleep(IDLE_MINUTES * 60_000 + 60_000),
    /** Local bake records, and the whole disk of a box forked from the bake. boat keeps no command history: monitoring is off. */
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
    unsupported: [{ operation: 'pause', attempt: ({ box }) => box.pause() }],
    async cleanup() {
      const api = await boatClient({ config })();
      const bake = savedSnapshotName({ name: snapshotName(`${repo.owner}/${repo.name}`) });
      const { sandboxes } = await api.sandboxes({ label: bakeFilter({ bake }), limit: 100 });
      for (const sandbox of sandboxes) {
        await api.deleteSandbox({ sandboxId: sandbox.id, xAsciiConfirmDelete: sandbox.id }).catch(() => {});
      }
      delete process.env.XDG_STATE_HOME;
      rmSync(stateDir, { recursive: true, force: true });
    },
  };
}

if (ENABLED) {
  describeProviderContract({
    name: 'boat',
    makeProvider: boatSubject,
    timeoutMs: 20 * 60_000,
  });
} else {
  test.skip('provider contract: boat (set L2B_CONTRACT_BOAT=1 to run against real boxes)', () => {});
}
