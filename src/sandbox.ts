import { Sandbox } from 'e2b';

const NAME_KEY = 'l2b';
export const ENV_FILE = '/dev/shm/l2b.env';
export const HOME = '/home/user';

export const DEFAULT_TEMPLATE = process.env.L2B_TEMPLATE ?? 'base';
export const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;

export async function findSandbox(name: string) {
  const paginator = Sandbox.list({
    query: { metadata: { [NAME_KEY]: name }, state: ['running', 'paused'] },
  });
  const items = await paginator.nextItems();
  return items[0] ?? null;
}

export async function listSandboxes() {
  const paginator = Sandbox.list({
    query: { state: ['running', 'paused'] },
  });
  const items = await paginator.nextItems();
  return items.filter((s) => s.metadata[NAME_KEY]);
}

export async function connect(name: string) {
  const info = await findSandbox(name);
  if (!info) throw new Error(`no sandbox named "${name}" (try: l2b ls)`);
  return Sandbox.connect(info.sandboxId, { timeoutMs: DEFAULT_TIMEOUT_MS });
}

export async function create({
  name,
  template,
}: {
  name: string;
  template: string;
}) {
  const existing = await findSandbox(name);
  if (existing) throw new Error(`sandbox "${name}" already exists`);
  return Sandbox.create(template, {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    metadata: { [NAME_KEY]: name },
  });
}

export function shellQuote(arg: string) {
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}
