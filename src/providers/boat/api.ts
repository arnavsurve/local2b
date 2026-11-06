import type { BoatApi } from '@boatdev/sdk';
import type { Config } from '../../config';
import { resolveValue, type ValueRef } from '../../secrets';
import { ProviderAuthError } from '../types';

const BASE_PATH = 'https://boat.dev/api/v1';

/** The SDK is large; loading it on first use keeps it off the path of commands that never talk to boat. */
export const loadSdk = () => import('@boatdev/sdk');

/** The HTTP response behind an SDK `ResponseError`, or null. */
export function responseOf(err: unknown): Response | null {
  if (err instanceof Error && err.name === 'ResponseError' && 'response' in err && err.response instanceof Response) {
    return err.response;
  }
  return null;
}

function describeRef({ ref }: { ref: ValueRef }) {
  switch (ref.from) {
    case 'env':
      return `set ${ref.name}, or point boat.apiKey at another value reference`;
    case 'file':
      return `put the key in ${ref.path}, or change boat.apiKey`;
    case 'doppler':
    case 'firstOf':
    case 'command':
      return 'check the boat.apiKey value reference in your config';
    default: {
      const unreachable: never = ref;
      throw new Error(`unknown value ref: ${JSON.stringify(unreachable)}`);
    }
  }
}

/** A client for boat's API, built once the key resolves. A missing key is a `ProviderAuthError`. */
export function boatClient({ config }: { config: Pick<Config['boat'], 'apiKey'> }) {
  let client: Promise<BoatApi> | null = null;
  const build = async () => {
    let key: string;
    try {
      key = await resolveValue(config.apiKey);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ProviderAuthError({ provider: 'boat', hint: `${reason}; ${describeRef({ ref: config.apiKey })}` });
    }
    const { BoatApi, Configuration } = await loadSdk();
    return new BoatApi(new Configuration({ basePath: BASE_PATH, accessToken: key }));
  };
  return () => {
    client ??= build().catch((err: unknown) => {
      client = null;
      throw err;
    });
    return client;
  };
}

export const isStatus = (err: unknown, status: number) => responseOf(err)?.status === status;

/**
 * Runs one API call and turns boat's error envelope into a readable error.
 * A rejected key becomes a `ProviderAuthError`.
 */
export async function boatCall<T>({ what, call }: { what: string; call: () => Promise<T> }): Promise<T> {
  try {
    return await call();
  } catch (err) {
    const response = responseOf(err);
    if (!response) throw err;
    const status = response.status;
    const body = (await response.clone().json().catch(() => null)) as { code?: string; message?: string } | null;
    const detail = [body?.code, body?.message].filter(Boolean).join(': ') || response.statusText;
    if (status === 401) {
      throw new ProviderAuthError({ provider: 'boat', hint: `boat rejected the API key (${detail}); check boat.apiKey` });
    }
    const wrapped = new Error(`boat ${what} failed (${status}${detail ? ` ${detail}` : ''})`);
    (wrapped as Error & { cause: unknown }).cause = err;
    throw wrapped;
  }
}

/** True when `err` (or the error it wraps) is boat's 404. */
export function isNotFound(err: unknown): boolean {
  if (isStatus(err, 404)) return true;
  return err instanceof Error && 'cause' in err && isStatus(err.cause, 404);
}

/** Best-effort cleanup must not fail the command, but it must not fail silently either. */
export function warnOnError(what: string) {
  return (err: unknown) => {
    console.error(`l2b: boat: ${what} failed: ${err instanceof Error ? err.message : String(err)}`);
  };
}
