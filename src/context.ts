import { loadConfig, type Config } from './config';
import { createProvider } from './providers';
import type { Provider } from './providers/types';

export type Context = { config: Config; provider: Provider };

export async function createContext(): Promise<Context> {
  const config = await loadConfig();
  return { config, provider: createProvider({ config }) };
}

export type Command = (opts: { ctx: Context; args: string[] }) => Promise<void>;
