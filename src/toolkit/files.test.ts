import { expect, test } from 'bun:test';
import { fakeMachineHost } from '../test/fake-machine';
import { putFile, remotePath } from './files';

const box = async () => {
  const fake = fakeMachineHost({ id: 'fake', execExitCode: 0, homeDir: '/home/user', failure: null });
  await fake.provider.create({ name: 'b', image: 'i', workdir: '/home/user/repo', idle: null });
  return { ...fake, box: await fake.provider.connect({ name: 'b' }) };
};

test('remotePath resolves relative, home and absolute paths', () => {
  const b = { workdir: '/w', homeDir: '/h' };
  expect(remotePath({ box: b, path: 'a/b.txt' })).toBe('/w/a/b.txt');
  expect(remotePath({ box: b, path: '~/x' })).toBe('/h/x');
  expect(remotePath({ box: b, path: '/tmp/x' })).toBe('/tmp/x');
});

test('removes the existing file before writing it', async () => {
  const { box: b, executed } = await box();
  const write = b.writeFile;
  b.writeFile = async (args) => {
    executed.push(`write ${args.path}`);
    await write(args);
  };
  await putFile({ box: b, path: '/tmp/x', content: 'x', executable: false });
  expect(executed).toEqual(["mkdir -p '/tmp' && rm -f '/tmp/x'", 'write /tmp/x']);
});

