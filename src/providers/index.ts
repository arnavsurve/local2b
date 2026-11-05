import type { Config } from '../config';
import { createE2bProvider } from './e2b/provider';
import { PROVIDER_IDS, type ProviderId } from './ids';
import type { Provider } from './types';

export { PROVIDER_IDS, type ProviderId };

export function createProvider({ id, config }: { id: ProviderId; config: Config }): Provider {
  switch (id) {
    case 'e2b':
      return createE2bProvider({
        config: config.e2b,
        idle: { ms: config.idle.minutes * 60_000, action: config.e2b.onIdle },
      });
    default: {
      const unreachable: never = id;
      throw new Error(`unknown provider: ${unreachable}`);
    }
  }
}
