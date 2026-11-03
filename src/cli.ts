#!/usr/bin/env bun
import { parseArgs } from 'node:util';
import {
  connect,
  create,
  DEFAULT_TEMPLATE,
  ENV_FILE,
  findSandbox,
  HOME,
  listSandboxes,
  shellQuote,
} from './sandbox';
import {
  dopplerSecrets,
  githubToken,
  resolveE2bKey,
  parseDopplerTarget,
  toEnvFile,
} from './creds';

const USAGE = `l2b - remote dev sandboxes on e2b

  l2b up <name> [--repo owner/repo] [--branch b] [--full] [--doppler project/config] [--template t]
  l2b exec <name> [--cwd dir] -- <cmd...>     run a command (secrets sourced)
  l2b creds <name> [--doppler project/config] refresh GH token + doppler secrets
  l2b url <name> <port>                       public URL for a port
  l2b ls
  l2b pause <name>
  l2b down <name>
`;

const [command, ...rest] = process.argv.slice(2);

async function pushCreds({
  sandbox,
  doppler,
}: {
  sandbox: Awaited<ReturnType<typeof connect>>;
  doppler: string | null;
}) {
  const vars: Record<string, string> = { GH_TOKEN: await githubToken() };
  if (doppler) Object.assign(vars, await dopplerSecrets(parseDopplerTarget(doppler)));
  await sandbox.files.write(ENV_FILE, toEnvFile(vars));
  await sandbox.commands.run(`chmod 600 ${ENV_FILE}`);
}

function withEnv(cmd: string) {
  return `[ -f ${ENV_FILE} ] && . ${ENV_FILE}; ${cmd}`;
}

async function run({
  sandbox,
  cmd,
  cwd,
}: {
  sandbox: Awaited<ReturnType<typeof connect>>;
  cmd: string;
  cwd: string;
}) {
  const result = await sandbox.commands.run(withEnv(cmd), {
    cwd,
    timeoutMs: 0,
    onStdout: (d) => {
      process.stdout.write(d);
    },
    onStderr: (d) => {
      process.stderr.write(d);
    },
  }).catch((err) => {
    if (err && typeof err === 'object' && 'exitCode' in err) return err;
    throw err;
  });
  return typeof result.exitCode === 'number' ? result.exitCode : 1;
}

async function main() {
  if (command && command !== 'help') process.env.E2B_API_KEY = await resolveE2bKey();
  switch (command) {
    case 'up': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          repo: { type: 'string' },
          branch: { type: 'string' },
          full: { type: 'boolean', default: false },
          doppler: { type: 'string' },
          template: { type: 'string', default: DEFAULT_TEMPLATE },
        },
      });
      const name = positionals[0];
      if (!name) throw new Error('usage: l2b up <name>');
      const sandbox = await create({ name, template: values.template });
      await pushCreds({ sandbox, doppler: values.doppler ?? null });
      await sandbox.commands.run(
        withEnv(
          `git config --global credential.helper '!f() { echo username=x-access-token; echo password=$GH_TOKEN; }; f'`
        )
      );
      if (values.repo) {
        const dir = values.repo.split('/').pop();
        const branchFlag = values.branch ? `-b ${shellQuote(values.branch)}` : '';
        const depthFlags = values.full ? '' : '--depth=1 --filter=blob:limit=50m';
        const code = await run({
          sandbox,
          cwd: HOME,
          cmd: `git clone --quiet ${depthFlags} ${branchFlag} https://github.com/${values.repo}.git ${dir}`,
        });
        if (code !== 0) process.exit(code);
      }
      console.log(`${name} ready (${sandbox.sandboxId})`);
      return;
    }
    case 'exec': {
      const sep = rest.indexOf('--');
      const head = sep === -1 ? rest : rest.slice(0, sep);
      const cmdParts = sep === -1 ? [] : rest.slice(sep + 1);
      const { values, positionals } = parseArgs({
        args: head,
        allowPositionals: true,
        options: { cwd: { type: 'string', default: HOME } },
      });
      const name = positionals[0];
      if (!name || cmdParts.length === 0) {
        throw new Error('usage: l2b exec <name> [--cwd dir] -- <cmd...>');
      }
      const sandbox = await connect(name);
      const code = await run({
        sandbox,
        cwd: values.cwd,
        cmd: cmdParts.map(shellQuote).join(' '),
      });
      process.exit(code);
    }
    case 'creds': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { doppler: { type: 'string' } },
      });
      const name = positionals[0];
      if (!name) throw new Error('usage: l2b creds <name>');
      await pushCreds({
        sandbox: await connect(name),
        doppler: values.doppler ?? null,
      });
      console.log('credentials refreshed');
      return;
    }
    case 'url': {
      const [name, port] = rest;
      if (!name || !port) throw new Error('usage: l2b url <name> <port>');
      const sandbox = await connect(name);
      console.log(`https://${sandbox.getHost(Number(port))}`);
      return;
    }
    case 'ls': {
      for (const s of await listSandboxes()) {
        console.log(`${s.metadata.l2b}\t${s.state}\t${s.sandboxId}\t${s.templateId}`);
      }
      return;
    }
    case 'pause':
    case 'down': {
      const name = rest[0];
      if (!name) throw new Error(`usage: l2b ${command} <name>`);
      const info = await findSandbox(name);
      if (!info) throw new Error(`no sandbox named "${name}"`);
      const sandbox = await connect(name);
      if (command === 'pause') await sandbox.pause();
      else await sandbox.kill();
      console.log(`${name}: ${command === 'pause' ? 'paused' : 'killed'}`);
      return;
    }
    default:
      console.log(USAGE);
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
