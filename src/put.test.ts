import { expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { putLocalFile } from './put';
import { fakeContext } from './test/fake-machine';

const box = async () => {
  const fake = fakeContext({ execExitCode: 0, failExecWhen: null, homeDir: '/home/user' });
  await fake.ctx.provider.create({ name: 'b', image: 'i', workdir: '/home/user/repo', idle: null });
  return { ...fake, box: await fake.ctx.provider.connect({ name: 'b' }) };
};

test('sends the file verbatim, creating parent dirs, without chmod for plain files', async () => {
  const { box: b, files, executed } = await box();
  const dir = mkdtempSync(join(tmpdir(), 'l2b-put-'));
  try {
    const local = join(dir, 'f.txt');
    const content = "it's `tricky` $(whoami) \"x\"\nline2\n";
    writeFileSync(local, content);
    await putLocalFile({ box: b, localPath: local, remote: 'sub/dir/f.txt' });
    expect(files.get('/home/user/sub/dir/f.txt')).toBe(content);
    expect(executed).toEqual(["mkdir -p '/home/user/sub/dir' && rm -f '/home/user/sub/dir/f.txt'"]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('preserves the exec bit', async () => {
  const { box: b, executed } = await box();
  const dir = mkdtempSync(join(tmpdir(), 'l2b-put-'));
  try {
    const local = join(dir, 's.sh');
    writeFileSync(local, '#!/bin/sh\n');
    chmodSync(local, 0o755);
    await putLocalFile({ box: b, localPath: local, remote: '/tmp/s.sh' });
    expect(executed).toEqual(["mkdir -p '/tmp' && rm -f '/tmp/s.sh'", "chmod +x '/tmp/s.sh'"]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('rejects binary files', async () => {
  const { box: b } = await box();
  const dir = mkdtempSync(join(tmpdir(), 'l2b-put-'));
  try {
    const local = join(dir, 'bin');
    writeFileSync(local, new Uint8Array([0xff, 0xfe, 0x00, 0x80]));
    await expect(putLocalFile({ box: b, localPath: local, remote: 'bin' })).rejects.toThrow('not valid UTF-8');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('errors when the local file is missing', async () => {
  const { box: b } = await box();
  await expect(putLocalFile({ box: b, localPath: '/nonexistent/zzz', remote: 'x' })).rejects.toThrow('cannot read');
});
