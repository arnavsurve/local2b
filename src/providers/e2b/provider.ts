import type { Config } from '../../config';
import type { IdlePolicy } from '../../toolkit/machine';
import { machineWorkflow } from '../../toolkit/workflow';
import type { Provider } from '../types';
import { createE2bMachineHost } from './machine';

/**
 * e2b runs the toolkit's snapshot-and-mirror workflow. A box expires through
 * e2b's own server-side timeout, set to the idle window at create and re-armed
 * by a heartbeat while l2b runs a command or a shell, so nothing local has to
 * survive for it to go away. On timeout e2b kills or pauses it (`idle.action`).
 */
export function createE2bProvider({ config, idle }: { config: Config['e2b']; idle: IdlePolicy }): Provider {
  return machineWorkflow({ host: createE2bMachineHost({ config, idle }) });
}
