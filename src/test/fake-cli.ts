import { readFileSync } from 'node:fs';
import { commands } from '../commands';
import { buildContext } from '../context';
import { isCommandName } from '../help';
import { extractProviderFlag } from '../providers/select';
import { fakeClock, fakeProvider, fakeWorldConfig, fakeWorldSchema } from './fake-provider';

/**
 * l2b's command line over the fake providers of a `fakeContext`, for the
 * processes l2b starts in the background: `bun fake-cli.ts <world.json> <command> ...`.
 */
async function main() {
  const [worldPath, ...rest] = process.argv.slice(2);
  if (!worldPath) throw new Error('usage: fake-cli.ts <world.json> <command> [args...]');
  const world = fakeWorldSchema.parse(JSON.parse(readFileSync(worldPath, 'utf8')));
  const clock = fakeClock({ start: Date.now() });
  const providers = world.providers.map(({ id, failure, root }) => fakeProvider({ id, clock, failure, root }).provider);
  const [first] = providers;
  if (!first) throw new Error('the fake world has no providers');
  const { providerId, args } = extractProviderFlag({ args: rest });
  const [name, ...commandArgs] = args;
  if (!name || !isCommandName(name)) throw new Error(`unknown command ${name}`);
  const ctx = buildContext({
    config: fakeWorldConfig(world),
    providers,
    configured: world.configured,
    defaultId: first.id,
    flag: providerId,
    env: null,
    cwd: process.cwd(),
    l2b: [process.execPath, import.meta.path, worldPath],
  });
  await commands[name]({ ctx, args: commandArgs });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
