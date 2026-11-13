import { splitOnDoubleDash } from './args';

type CommandHelp = {
  usage: string;
  summary: string;
  flags: [string, string][];
};

const SHARED_FLAGS: [string, string][] = [
  ['--repo owner/repo', 'repository to check out (default: origin of the checkout in cwd)'],
  ['--branch b', "branch to check out (default: that checkout's current branch)"],
  ['--full', 'full clone instead of the partial mirror'],
  ['--doppler project/config', 'doppler secrets to load into the box'],
  ['--image ref', 'base image override'],
  ['--install cmd', 'install command override'],
];

/** One entry per command: the source for `--help` and for usage errors. */
export const COMMAND_HELP = {
  run: {
    usage: 'l2b run [--repo owner/repo] [--branch b] [--keep] [--name n] -- <cmd...>',
    summary: 'one-shot: box up, run, box destroyed (exit code passes through)',
    flags: [
      ...SHARED_FLAGS,
      ['--keep', 'keep the box after the command finishes'],
      ['--name n', 'box name (default: generated)'],
    ],
  },
  up: {
    usage: 'l2b up <name> [--repo owner/repo] [--branch b] [--full] [--doppler project/config] [--image ref]',
    summary: 'create a box and check out the repo',
    flags: SHARED_FLAGS,
  },
  bake: {
    usage: 'l2b bake [owner/repo] [--if-older-than 12h]',
    summary: 'build the per-repo snapshot (bare mirror + warm install)',
    flags: [
      ['--if-older-than 12h', 'skip when the existing snapshot is newer'],
      ['--branch b', 'branch to warm'],
      ['--doppler project/config', 'doppler secrets to load into the box'],
      ['--image ref', 'base image override'],
      ['--install cmd', 'install command override'],
      ['--warm cmd', 'command run after install to warm caches'],
    ],
  },
  init: {
    usage: 'l2b init',
    summary: 'write a starter .l2b.json in the current directory',
    flags: [],
  },
  exec: {
    usage: 'l2b exec <name> [--cwd dir] [--detach] -- <cmd...>',
    summary: 'run a command in the box (default cwd: the repo checkout)',
    flags: [
      ['--cwd dir', 'working directory in the box'],
      ['--detach', 'start the command in the background and print a job id'],
    ],
  },
  logs: {
    usage: 'l2b logs <name> <job> [--follow]',
    summary: "a detached job's output and status (running or exited N)",
    flags: [['--follow, -f', "stream until the job ends; exits with the job's exit code"]],
  },
  jobs: {
    usage: 'l2b jobs <name>',
    summary: "a box's detached jobs and their status",
    flags: [],
  },
  put: {
    usage: 'l2b put <name> <local|-> <remote>',
    summary: 'send a text file into a box (- reads stdin; parent dirs created, exec bit kept)',
    flags: [],
  },
  creds: {
    usage: 'l2b creds <name> [--repo o/r] [--doppler project/config]',
    summary: 'refresh GH token + doppler secrets',
    flags: [
      ['--repo o/r', 'repository whose config to use'],
      ['--doppler project/config', 'doppler secrets to load into the box'],
    ],
  },
  shell: {
    usage: 'l2b shell <name> [--cwd dir]',
    summary: 'interactive terminal (needs a TTY)',
    flags: [['--cwd dir', 'working directory in the box']],
  },
  install: {
    usage: 'l2b install',
    summary: 'install the agent skill (from a checkout, also put l2b on PATH)',
    flags: [],
  },
  update: {
    usage: 'l2b update',
    summary: 'replace this binary with the latest release and refresh the skill',
    flags: [],
  },
  url: {
    usage: 'l2b url <name> <port>',
    summary: 'public URL for a port',
    flags: [],
  },
  image: {
    usage: 'l2b image build',
    summary: 'build the base image for the configured provider',
    flags: [],
  },
  ls: {
    usage: 'l2b ls',
    summary: 'boxes on every configured provider',
    flags: [],
  },
  pause: { usage: 'l2b pause <name>', summary: 'pause a box', flags: [] },
  down: { usage: 'l2b down <name>', summary: 'destroy a box', flags: [] },
} satisfies Record<string, CommandHelp>;

export type CommandName = keyof typeof COMMAND_HELP;

export function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(COMMAND_HELP, name);
}

export function usageError(name: CommandName) {
  return new Error(`usage: ${COMMAND_HELP[name].usage}\n(l2b ${name} --help for flags)`);
}

export function commandHelp(name: CommandName) {
  const { usage, summary, flags } = COMMAND_HELP[name];
  const lines = [usage, '', summary];
  const all: [string, string][] = [...flags, ['--provider id', 'pick the provider (also L2B_PROVIDER)']];
  const width = Math.max(...all.map(([flag]) => flag.length));
  lines.push('', 'flags:', ...all.map(([flag, desc]) => `  ${flag.padEnd(width)}  ${desc}`));
  return lines.join('\n') + '\n';
}

export function rootHelp() {
  const names = Object.keys(COMMAND_HELP).filter(isCommandName);
  const width = Math.max(...names.map((n) => COMMAND_HELP[n].usage.length));
  const rows = names.map((n) => `  ${COMMAND_HELP[n].usage.padEnd(width)}  ${COMMAND_HELP[n].summary}`);
  return [
    'l2b - remote dev sandboxes',
    '',
    ...rows,
    '',
    '  l2b <command> --help shows a command\'s flags',
    '  l2b --version prints the version',
    '  --provider <id> (any command) picks the provider; also L2B_PROVIDER and repos.<o/r>.provider in the config',
    '',
  ].join('\n');
}

export function wantsHelp({ args }: { args: string[] }) {
  const { head } = splitOnDoubleDash(args);
  return head.includes('--help') || head.includes('-h');
}
