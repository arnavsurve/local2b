import { expect, test } from 'bun:test';
import { configSchema } from '../../config';
import { ProviderAuthError } from '../types';
import { createBoatProvider } from './provider';

test('a missing API key surfaces as an auth error naming the variable to set', async () => {
  delete process.env.L2B_TEST_MISSING_BOAT_KEY;
  const config = configSchema.parse({ boat: { apiKey: { from: 'env', name: 'L2B_TEST_MISSING_BOAT_KEY' } } });
  const provider = createBoatProvider({ config: config.boat, idle: { ms: 60_000 } });
  const err = await provider.exists({ name: 'x' }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ProviderAuthError);
  expect(String(err)).toContain('set L2B_TEST_MISSING_BOAT_KEY');
});

test('the boat block defaults to BOAT_API_KEY and counts as configured once present', () => {
  expect(configSchema.parse({}).boat.apiKey).toEqual({ from: 'env', name: 'BOAT_API_KEY' });
  expect(configSchema.parse({}).configuredProviders).toEqual(['e2b']);
  expect(configSchema.parse({ boat: {} }).configuredProviders).toEqual(['e2b', 'boat']);
  expect(configSchema.parse({ provider: 'boat' }).configuredProviders).toEqual(['boat']);
});
