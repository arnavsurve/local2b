import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import type { ExecOutput, StartOpts } from './providers/types';
import { generatedBoxName, runOnce } from './run-once';
import { fakeClock, fakeProvider } from './test/fake-provider';

let fake: ReturnType<typeof fakeProvider>;
let quiet: ReturnType<typeof spyOn>;

beforeEach(() => {
  fake = fakeProvider({ id: 'fake', clock: fakeClock({ start: Date.now() }), failure: null, root: null });
  quiet = spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  quiet.mockRestore();
  fake.cleanup();
});

const start: StartOpts = {
  name: 'run-test',
  repo: null,
  branch: null,
  source: 'bake',
  image: null,
  idle: { minutes: 15 },
  credentials: { variables: {}, git: null },
  gitIdentity: null,
};

const once = ({ cmd, after, onOutput }: { cmd: string; after: 'destroy' | 'keep'; onOutput: (o: ExecOutput) => void }) =>
  runOnce({ provider: fake.provider, start, cmd, label: cmd, after, onOutput });

test('returns the command exit code and leaves no box behind', async () => {
  expect(await once({ cmd: 'exit 3', after: 'destroy', onOutput: () => {} })).toBe(3);
  expect(fake.alive()).toEqual([]);
});

test('destroys the box even when handling the output blows up', async () => {
  const run = once({
    cmd: 'echo hi',
    after: 'destroy',
    onOutput: () => {
      throw new Error('output sink failed');
    },
  });
  await expect(run).rejects.toThrow('output sink failed');
  expect(fake.alive()).toEqual([]);
});

test('keep leaves the box alive for follow-up commands', async () => {
  await once({ cmd: 'true', after: 'keep', onOutput: () => {} });
  expect(fake.alive()).toEqual(['run-test']);
});

test('generated names are unique and carry the repo name', () => {
  const a = generatedBoxName({ repo: 'o/escher' });
  const b = generatedBoxName({ repo: 'o/escher' });
  expect(a).toMatch(/^run-escher-[0-9a-f]{6}$/);
  expect(a).not.toBe(b);
});
