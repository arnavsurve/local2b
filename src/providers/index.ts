import type { Config } from '../config';
import { createE2bMachineHost } from './e2b/machine';
import { PROVIDER_IDS, type ProviderId } from './ids';
import type { MachineHost } from '../toolkit/machine';

export { PROVIDER_IDS, type ProviderId };

export function createProvider({ id, config }: { id: ProviderId; config: Config }): MachineHost {
  switch (id) {
    case 'e2b':
      return createE2bMachineHost({
        config: config.e2b,
        idle: { ms: config.idle.minutes * 60_000, action: config.idle.action },
      });
    default: {
      const unreachable: never = id;
      throw new Error(`unknown provider: ${unreachable}`);
    }
  }
}
