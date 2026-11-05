import { expect, test } from 'bun:test';
import { withHeartbeat } from './keepalive';

test('beats while a slow task runs, then stops once it finishes', async () => {
  let beats = 0;
  const beat = async () => {
    beats += 1;
  };
  const result = await withHeartbeat({
    intervalMs: 10,
    beat,
    task: async () => {
      await Bun.sleep(65);
      return 'done';
    },
  });
  expect(result).toBe('done');
  const settled = beats;
  expect(settled).toBeGreaterThanOrEqual(5);
  await Bun.sleep(40);
  expect(beats).toBe(settled);
});

test('beats on both sides of a failing task and rethrows', async () => {
  let beats = 0;
  const run = withHeartbeat({
    intervalMs: 1000,
    beat: async () => {
      beats += 1;
    },
    task: async () => {
      throw new Error('boom');
    },
  });
  await expect(run).rejects.toThrow('boom');
  expect(beats).toBe(2);
});
