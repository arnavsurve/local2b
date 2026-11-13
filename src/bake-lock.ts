import { acquireLock, lockHolder, releaseLock, transferLock, type Lock } from './lock';
import { stateSlug } from './state';

/** The lock one bake of a repo on a provider holds while it runs. */
export type BakeLock = Lock;

type Target = { provider: string; repo: string };

const name = (target: Target) => `bake-${stateSlug(target)}`;

export const acquireBakeLock = ({ provider, repo, ...rest }: Target & { pid: number; log: string | null }) =>
  acquireLock({ name: name({ provider, repo }), ...rest });

export const bakeLockHolder = (target: Target) => lockHolder({ name: name(target) });

export const transferBakeLock = ({ provider, repo, ...rest }: Target & { token: string; pid: number }) =>
  transferLock({ name: name({ provider, repo }), ...rest });

export const releaseBakeLock = ({ provider, repo, ...rest }: Target & { token: string }) =>
  releaseLock({ name: name({ provider, repo }), ...rest });
