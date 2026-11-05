import { expect, test } from 'bun:test';
import { configSchema } from '../../config';
import { ProviderAuthError } from '../types';
import { createE2bProvider } from './provider';

test('a missing API key surfaces as an auth error naming the variable to set', async () => {
  delete process.env.L2B_TEST_MISSING_KEY;
  const config = configSchema.parse({
    e2b: { apiKey: { from: 'env', name: 'L2B_TEST_MISSING_KEY' } },
  });
  const provider = createE2bProvider({ config: config.e2b, idle: { ms: 60_000, action: 'kill' } });
  const err = await provider.exists({ name: 'x' }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ProviderAuthError);
  expect(String(err)).toContain('set L2B_TEST_MISSING_KEY');
});
