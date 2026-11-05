import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Box } from './providers/types';
import { putLocalFile } from './put';
import { fakeClock, fakeProvider } from './test/fake-provider';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup() {
  const fake = fakeProvider({ id: 'fake', clock: fakeClock({ start: Date.now() }), failure: null });
  const local = mkdtempSync(join(tmpdir(), 'l2b-put-'));
  cleanups.push(fake.cleanup, () => rmSync(local, { recursive: true, force: true }));
  const box = await fake.provider.start({
    name: 'b',
    repo: null,
    branch: null,
    source: 'fresh',
    image: null,
    idle: { minutes: 15 },
    credentials: { variables: {}, git: null },
    gitIdentity: null,
  });
  return { box, local };
}

async function run({ box, cmd }: { box: Box; cmd: string }) {
  let stdout = '';
  const exitCode = await box.exec({ cmd, cwd: null, onOutput: (o) => (stdout += o.stream === 'stdout' ? o.data : '') });
  return { exitCode, stdout };
}

test('sends the file verbatim under the workdir, creating parent dirs, not executable', async () => {
  const { box, local } = await setup();
  const file = join(local, 'f.txt');
  const content = "it's `tricky` $(whoami) \"x\"\nline2\n";
  writeFileSync(file, content);
  const path = await putLocalFile({ box, localPath: file, remote: 'sub/dir/f.txt' });
  expect(path).toBe(`${box.workdir}/sub/dir/f.txt`);
  expect((await run({ box, cmd: `cat '${path}'` })).stdout).toBe(content);
  expect((await run({ box, cmd: `test -x '${path}'` })).exitCode).not.toBe(0);
});

test('preserves the exec bit', async () => {
  const { box, local } = await setup();
  const file = join(local, 's.sh');
  writeFileSync(file, '#!/bin/sh\necho ran\n');
  chmodSync(file, 0o755);
  const path = await putLocalFile({ box, localPath: file, remote: 'bin/s.sh' });
  expect((await run({ box, cmd: `'${path}'` })).stdout).toBe('ran\n');
});

test('rejects binary files', async () => {
  const { box, local } = await setup();
  const file = join(local, 'bin');
  writeFileSync(file, new Uint8Array([0xff, 0xfe, 0x00, 0x80]));
  await expect(putLocalFile({ box, localPath: file, remote: 'bin' })).rejects.toThrow('not valid UTF-8');
});

test('errors when the local file is missing', async () => {
  const { box } = await setup();
  await expect(putLocalFile({ box, localPath: '/nonexistent/zzz', remote: 'x' })).rejects.toThrow('cannot read');
});
