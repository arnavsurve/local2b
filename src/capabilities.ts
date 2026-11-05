import type { IdlePolicy, Provider } from './providers/types';
import { formatAge } from './snapshots';

const DAY_MS = 24 * 3_600_000;

/**
 * Notes to print before creating a box with this idle policy. Throws when the
 * provider can't honour the policy at all, so no box is created only to fail later.
 */
export function boxPolicyNotes({ provider, action }: { provider: Provider; action: IdlePolicy['action'] }) {
  return [idleNote({ provider, action }), lifetimeNote({ provider })].filter((note) => note !== null);
}

function idleNote({ provider, action }: { provider: Provider; action: IdlePolicy['action'] }) {
  if (action === 'kill') return null;
  switch (provider.capabilities.pause) {
    case null:
      throw new Error(`idle.action "pause" is not supported by provider ${provider.id}; set idle.action to "kill"`);
    case 'disk':
      return `provider ${provider.id} pauses to disk: paused boxes keep their disk but not memory or running processes`;
    case 'memory':
      return null;
    default: {
      const unreachable: never = provider.capabilities.pause;
      throw new Error(`unknown pause capability: ${unreachable}`);
    }
  }
}

function lifetimeNote({ provider }: { provider: Provider }) {
  const { maxLifetimeMs } = provider.capabilities;
  if (maxLifetimeMs === null || maxLifetimeMs >= DAY_MS) return null;
  const age = formatAge({ hours: maxLifetimeMs / 3_600_000 });
  return `provider ${provider.id} ends every box after ${age}, whatever its activity; push work you want to keep`;
}

export function requirePause({ provider, name }: { provider: Provider; name: string }) {
  if (provider.capabilities.pause === null) {
    throw new Error(`provider ${provider.id} can't pause boxes; use l2b down ${name}`);
  }
}

export function requireShell({ provider, name }: { provider: Provider; name: string }) {
  if (provider.capabilities.shell === null) {
    throw new Error(`provider ${provider.id} has no interactive shell; use l2b exec ${name} -- <cmd>`);
  }
}
