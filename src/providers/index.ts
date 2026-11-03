import type { Config } from '../config';
import { createE2bProvider } from './e2b/provider';
import type { Provider } from './types';

export function createProvider({ config }: { config: Config }): Provider {
  switch (config.provider) {
    case 'e2b':
      return createE2bProvider({ config: config.e2b });
    default: {
      const unreachable: never = config.provider;
      throw new Error(`unknown provider: ${unreachable}`);
    }
  }
}
