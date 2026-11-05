import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { runOnceWith } from '../run-once';
import { UnsupportedError, type Box, type Credentials, type ExecOutput, type Provider, type RepoSpec } from './types';

/** What a provider under test supplies to the contract suite. */
export type ContractSubject = {
  provider: Provider;
  /** A repo the provider's boxes can clone with `credentials`. */
  repo: RepoSpec;
  /** A branch that exists on the repo's remote. */
  branch: string;
  /** Credentials that let a box read the repo; the suite adds variables of its own. */
  credentials: Credentials;
  idle: { minutes: number };
  /** Lets more than `idle` pass with no activity: advances a fake clock, or sleeps on a real provider. */
  passIdleTime(): Promise<void>;
  /**
   * Where `value` appears in anything the provider keeps beyond a box's
   * memory (images, bakes, snapshots, disks, command history) that the
   * adapter can inspect. Empty when it appears nowhere.
   */
  findPersisted(opts: { value: string }): Promise<string[]>;
  /** Operations this provider documents as unsupported; each must throw `UnsupportedError`. */
  unsupported: { operation: string; attempt: (opts: { provider: Provider; box: Box }) => Promise<unknown> }[];
  cleanup(): Promise<void>;
};

const INSTALL_MARKER = '.l2b-contract-installed';
const VAR = 'L2B_CONTRACT_VAR';

/** Writes the length of a credential, never its value, so the install provably saw credentials. */
const INSTALL = `printf '%s' "\${#${VAR}}" > ${INSTALL_MARKER}`;

const uniqueName = (prefix: string) => `${prefix}-${randomBytes(3).toString('hex')}`;

async function capture({ box, cmd, cwd }: { box: Box; cmd: string; cwd: string | null }) {
  const out: ExecOutput[] = [];
  const exitCode = await box.exec({ cmd, cwd, onOutput: (o) => out.push(o) });
  const text = (stream: ExecOutput['stream']) =>
    out.filter((o) => o.stream === stream).map((o) => o.data).join('');
  return { exitCode, stdout: text('stdout'), stderr: text('stderr') };
}

async function stdoutOf({ box, cmd }: { box: Box; cmd: string }) {
  const result = await capture({ box, cmd, cwd: null });
  if (result.exitCode !== 0) throw new Error(`${cmd} exited ${result.exitCode}: ${result.stderr}`);
  return result.stdout.trim();
}

/**
 * The functionality every provider must deliver, whatever primitives it uses.
 * Register it from a test file: `describeProviderContract({ name, makeProvider })`.
 */
export function describeProviderContract({
  name,
  makeProvider,
  timeoutMs,
}: {
  name: string;
  makeProvider: () => Promise<ContractSubject>;
  /** Per test; real providers need minutes. */
  timeoutMs: number;
}) {
  describe(`provider contract: ${name}`, () => {
    let subject: ContractSubject;
    const canary = `canary-${randomBytes(12).toString('hex')}`;

    beforeAll(async () => {
      subject = await makeProvider();
    }, timeoutMs);
    afterAll(async () => {
      await subject.cleanup();
    }, timeoutMs);

    const credentials = ({ value }: { value: string }): Credentials => ({
      ...subject.credentials,
      variables: { ...subject.credentials.variables, [VAR]: value },
    });
    const repo = (): RepoSpec => ({ ...subject.repo, install: INSTALL, env: { L2B_CONTRACT_PLAIN: 'plain' } });

    async function withBox<T>({
      branch,
      useRepo,
      value,
      run,
    }: {
      branch: string | null;
      useRepo: 'repo' | 'none';
      value: string;
      run: (box: Box) => Promise<T>;
    }) {
      const box = await subject.provider.start({
        name: uniqueName('contract'),
        repo: useRepo === 'repo' ? repo() : null,
        branch,
        source: 'fresh',
        image: null,
        idle: subject.idle,
        credentials: credentials({ value }),
        gitIdentity: null,
      });
      try {
        return await run(box);
      } finally {
        await box.destroy();
      }
    }

    const remoteTip = ({ box, ref }: { box: Box; ref: string }) =>
      stdoutOf({ box, cmd: `git ls-remote origin ${ref} | cut -f1` });

    async function expectCheckoutOf({ box, branch, ref }: { box: Box; branch: string; ref: string }) {
      expect(await stdoutOf({ box, cmd: 'git branch --show-current' })).toBe(branch);
      expect(await stdoutOf({ box, cmd: 'git rev-parse HEAD' })).toBe(await remoteTip({ box, ref }));
      expect(await stdoutOf({ box, cmd: `cat ${INSTALL_MARKER}` })).toBe(String(canary.length));
    }

    test('start checks out the branch in the workdir with dependencies installed', async () => {
      await withBox({
        branch: subject.branch,
        useRepo: 'repo',
        value: canary,
        run: async (box) => {
          expect(await stdoutOf({ box, cmd: 'pwd -P' })).toBe(await stdoutOf({ box, cmd: `cd ${box.workdir} && pwd -P` }));
          await expectCheckoutOf({ box, branch: subject.branch, ref: `refs/heads/${subject.branch}` });
        },
      });
    }, timeoutMs);

    test('a box without a repo runs commands in its workdir', async () => {
      await withBox({
        branch: null,
        useRepo: 'none',
        value: canary,
        run: async (box) => {
          expect(await stdoutOf({ box, cmd: 'pwd -P' })).toBe(await stdoutOf({ box, cmd: `cd ${box.workdir} && pwd -P` }));
        },
      });
    }, timeoutMs);

    test('exec streams stdout and stderr apart, returns the exit code and honours cwd', async () => {
      await withBox({
        branch: null,
        useRepo: 'none',
        value: canary,
        run: async (box) => {
          const result = await capture({ box, cmd: 'echo out; echo err >&2; exit 3', cwd: null });
          expect(result).toEqual({ exitCode: 3, stdout: 'out\n', stderr: 'err\n' });
          expect((await capture({ box, cmd: 'pwd -P', cwd: '/' })).stdout.trim()).toBe('/');
        },
      });
    }, timeoutMs);

    test('a background process started by exec outlives it and sees the env', async () => {
      await withBox({
        branch: null,
        useRepo: 'none',
        value: canary,
        run: async (box) => {
          const marker = '"$HOME/.l2b-contract-background"';
          const started = Date.now();
          const launch = `nohup sh -c 'sleep 2; printf %s "$${VAR}" > ${marker}' >/dev/null 2>&1 </dev/null &`;
          expect((await capture({ box, cmd: launch, cwd: null })).exitCode).toBe(0);
          expect(Date.now() - started).toBeLessThan(30_000);
          let seen = '';
          for (let i = 0; i < 60 && seen === ''; i++) {
            await Bun.sleep(500);
            seen = (await capture({ box, cmd: `cat ${marker} 2>/dev/null`, cwd: null })).stdout;
          }
          expect(seen).toBe(canary);
        },
      });
    }, timeoutMs);

    test('put writes text relative to the workdir, the home or an absolute path, replacing what is there', async () => {
      await withBox({
        branch: subject.branch,
        useRepo: 'repo',
        value: canary,
        run: async (box) => {
          const cat = async (path: string) => (await capture({ box, cmd: `cat '${path}'`, cwd: null })).stdout;
          const isExecutable = async (path: string) => (await capture({ box, cmd: `test -x '${path}'`, cwd: null })).exitCode === 0;
          const tricky = "it's `tricky` $(whoami) \"x\"\nline2\n";

          const relative = await box.put({ path: 'l2b-contract/sub/f.txt', content: tricky, executable: false });
          expect(relative).toBe(`${box.workdir}/l2b-contract/sub/f.txt`);
          expect(await cat(relative)).toBe(tricky);
          expect(await isExecutable(relative)).toBe(false);

          const home = await stdoutOf({ box, cmd: 'printf %s "$HOME"' });
          const script = await box.put({ path: '~/.l2b-contract/run.sh', content: '#!/bin/sh\necho hi\n', executable: true });
          expect(script).toBe(`${home}/.l2b-contract/run.sh`);
          expect(await isExecutable(script)).toBe(true);
          expect(await stdoutOf({ box, cmd: `'${script}'` })).toBe('hi');

          const tmp = `/tmp/${uniqueName('l2b-contract-put')}`;
          try {
            expect(await box.put({ path: tmp, content: 'one\n', executable: false })).toBe(tmp);
            await box.put({ path: tmp, content: 'two\n', executable: false });
            expect(await cat(tmp)).toBe('two\n');
          } finally {
            await capture({ box, cmd: `rm -f '${tmp}'`, cwd: null });
          }
        },
      });
    }, timeoutMs);

    test('a box started with a git identity commits as that author', async () => {
      const box = await subject.provider.start({
        name: uniqueName('contract'),
        repo: repo(),
        branch: subject.branch,
        source: 'fresh',
        image: null,
        idle: subject.idle,
        credentials: credentials({ value: canary }),
        gitIdentity: { name: "Ada O'Neil", email: 'ada@example.com' },
      });
      try {
        expect(await stdoutOf({ box, cmd: 'git config --global --get user.email' })).toBe('ada@example.com');
        await stdoutOf({ box, cmd: 'git commit -q --allow-empty -m l2b-contract' });
        expect(await stdoutOf({ box, cmd: 'git log -1 --format=%an,%ae' })).toBe("Ada O'Neil,ada@example.com");
      } finally {
        await box.destroy();
      }
    }, timeoutMs);

    test('credentials and repo env reach commands, and a refresh replaces them', async () => {
      await withBox({
        branch: subject.branch,
        useRepo: 'repo',
        value: canary,
        run: async (box) => {
          expect(await stdoutOf({ box, cmd: `printf %s "$${VAR}"` })).toBe(canary);
          expect(await stdoutOf({ box, cmd: 'printf %s "$L2B_CONTRACT_PLAIN"' })).toBe('plain');
          const refreshed = `${canary}-refreshed`;
          await box.refreshCredentials({ credentials: credentials({ value: refreshed }) });
          expect(await stdoutOf({ box, cmd: `printf %s "$${VAR}"` })).toBe(refreshed);
          const connected = await subject.provider.connect({ name: box.name });
          expect(connected.workdir).toBe(box.workdir);
          expect(await stdoutOf({ box: connected, cmd: `printf %s "$${VAR}"` })).toBe(refreshed);
        },
      });
    }, timeoutMs);

    test('credentials are never persisted, logged or written to disk', async () => {
      const secret = `${canary}-secret`;
      await subject.provider.bake({ repo: repo(), credentials: credentials({ value: secret }), image: null });
      await withBox({
        branch: subject.branch,
        useRepo: 'repo',
        value: secret,
        run: async (box) => {
          const onDisk = await stdoutOf({
            box,
            cmd: `grep -rlF -e "$${VAR}" "$HOME" "\${TMPDIR:-/tmp}" 2>/dev/null || true`,
          });
          expect(onDisk).toBe('');
        },
      });
      expect(await subject.findPersisted({ value: secret })).toEqual([]);
    }, timeoutMs);

    test('a bake records its time, and later starts use it, creating a branch missing on the remote', async () => {
      expect(await subject.provider.bakedAt({ repo: { ...repo(), name: uniqueName('never-baked') } })).toBeNull();
      const result = await subject.provider.bake({ repo: repo(), credentials: credentials({ value: canary }), image: null });
      expect(result.summary).not.toBe('');
      const bakedAt = await subject.provider.bakedAt({ repo: repo() });
      expect(bakedAt?.getTime()).toBe(result.bakedAt.getTime());
      const fromBake = async ({ branch, ref }: { branch: string; ref: string }) => {
        const box = await subject.provider.start({
          name: uniqueName('contract'),
          repo: repo(),
          branch,
          source: 'bake',
          image: null,
          idle: subject.idle,
          credentials: credentials({ value: canary }),
          gitIdentity: null,
        });
        try {
          await expectCheckoutOf({ box, branch, ref });
        } finally {
          await box.destroy();
        }
      };
      await fromBake({ branch: subject.branch, ref: `refs/heads/${subject.branch}` });
      await fromBake({ branch: uniqueName('l2b-contract-new'), ref: 'HEAD' });
    }, timeoutMs);

    const runOnce = ({ cmd, onOutput }: { cmd: string; onOutput: (o: ExecOutput) => void }) => {
      const boxName = uniqueName('contract-run');
      const run = runOnceWith({
        provider: subject.provider,
        start: {
          name: boxName,
          repo: null,
          branch: null,
          source: 'fresh',
          image: null,
          idle: subject.idle,
          credentials: credentials({ value: canary }),
          gitIdentity: null,
        },
        cmd,
        label: cmd,
        after: 'destroy',
        onOutput,
      });
      return { boxName, run };
    };

    const expectGone = async (boxName: string) => {
      expect(await subject.provider.exists({ name: boxName })).toBe(false);
      expect((await subject.provider.list()).map((b) => b.name)).not.toContain(boxName);
    };

    test('run-once passes the exit code through and destroys the box on success and failure', async () => {
      for (const code of [0, 7]) {
        const { boxName, run } = runOnce({ cmd: `exit ${code}`, onOutput: () => {} });
        expect(await run).toBe(code);
        await expectGone(boxName);
      }
    }, timeoutMs);

    test('run-once destroys the box when the command throws', async () => {
      const { boxName, run } = runOnce({
        cmd: 'echo boom',
        onOutput: () => {
          throw new Error('output sink failed');
        },
      });
      await expect(run).rejects.toThrow();
      await expectGone(boxName);
    }, timeoutMs);

    test('a start that fails leaves no box behind', async () => {
      const name = uniqueName('contract-bad');
      const broken: RepoSpec = { ...repo(), install: 'exit 9' };
      await expect(
        subject.provider.start({
          name,
          repo: broken,
          branch: subject.branch,
          source: 'fresh',
          image: null,
          idle: subject.idle,
          credentials: credentials({ value: canary }),
          gitIdentity: null,
        })
      ).rejects.toThrow();
      await expectGone(name);
    }, timeoutMs);

    test('a live name cannot be started twice and the first box survives', async () => {
      await withBox({
        branch: null,
        useRepo: 'none',
        value: canary,
        run: async (box) => {
          await expect(
            subject.provider.start({
              name: box.name,
              repo: null,
              branch: null,
              source: 'fresh',
              image: null,
              idle: subject.idle,
              credentials: credentials({ value: canary }),
              gitIdentity: null,
            })
          ).rejects.toThrow();
          expect(await subject.provider.exists({ name: box.name })).toBe(true);
          expect((await capture({ box, cmd: 'true', cwd: null })).exitCode).toBe(0);
        },
      });
    }, timeoutMs);

    test('destroy removes the box, and connecting to an unknown name fails', async () => {
      const name = await withBox({ branch: null, useRepo: 'none', value: canary, run: async (box) => box.name });
      await expectGone(name);
      await expect(subject.provider.connect({ name })).rejects.toThrow();
    }, timeoutMs);

    test('an idle box expires on its own', async () => {
      const box = await subject.provider.start({
        name: uniqueName('contract-idle'),
        repo: null,
        branch: null,
        source: 'fresh',
        image: null,
        idle: subject.idle,
        credentials: credentials({ value: canary }),
        gitIdentity: null,
      });
      expect(await subject.provider.exists({ name: box.name })).toBe(true);
      await subject.passIdleTime();
      await expectGone(box.name);
    }, timeoutMs);

    test('unsupported operations throw UnsupportedError', async () => {
      await withBox({
        branch: null,
        useRepo: 'none',
        value: canary,
        run: async (box) => {
          for (const { attempt } of subject.unsupported) {
            const err = await attempt({ provider: subject.provider, box }).then(
              () => null,
              (e: unknown) => e
            );
            expect(err).toBeInstanceOf(UnsupportedError);
          }
        },
      });
    }, timeoutMs);
  });
}
