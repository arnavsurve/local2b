import { expect, test } from 'bun:test';
import { DEFAULT_FEATURES, aptPackageList, globalInstallCommands, rootCommands } from './recipe';

const TODAYS_APT_PACKAGES = [
  'git',
  'curl',
  'jq',
  'sudo',
  'ca-certificates',
  'gnupg',
  'build-essential',
  'python3',
  'python3-setuptools',
  'postgresql',
  'postgresql-16-pgvector',
  'redis-server',
  'ripgrep',
  'tmux',
];

const TODAYS_ROOT_COMMANDS = [
  'curl -fsSL https://deb.nodesource.com/setup_24.x | bash -',
  'apt-get install -y nodejs',
  'corepack enable',
  'curl -fsSL https://github.com/cli/cli/releases/download/v2.67.0/gh_2.67.0_linux_amd64.tar.gz | tar -xz -C /usr/local --strip-components=1',
  "curl -sLf --retry 3 --tlsv1.2 --proto '=https' 'https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key' | gpg --dearmor -o /usr/share/keyrings/doppler-archive-keyring.gpg",
  'echo "deb [signed-by=/usr/share/keyrings/doppler-archive-keyring.gpg] https://packages.doppler.com/public/cli/deb/debian any-version main" > /etc/apt/sources.list.d/doppler-cli.list',
  'apt-get update && apt-get install -y doppler',
  'curl -fsSL https://get.docker.com | sh',
  'id user >/dev/null 2>&1 || useradd -m -s /bin/bash user',
  "echo 'user ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/user",
  'usermod -aG docker user || true',
  'rm -rf /var/lib/apt/lists/*',
];

test('the default composition equals the image built before features were configurable', () => {
  expect(aptPackageList({ features: DEFAULT_FEATURES, extra: [] })).toEqual(TODAYS_APT_PACKAGES);
  expect(rootCommands({ features: DEFAULT_FEATURES, nodeMajor: 24, npmGlobals: [] })).toEqual(
    TODAYS_ROOT_COMMANDS
  );
});

test('npm globals install right after node is set up', () => {
  const commands = rootCommands({ features: DEFAULT_FEATURES, nodeMajor: 24, npmGlobals: ['bun'] });
  expect(commands.indexOf('corepack enable') + 1).toBe(
    commands.indexOf('npm install -g --allow-scripts=bun bun')
  );
});

test('each global package gets its own install allowed to run its own scripts', () => {
  expect(globalInstallCommands({ npmGlobals: ['bun', '@scope/tool'] })).toEqual([
    'npm install -g --allow-scripts=bun bun',
    'npm install -g --allow-scripts=@scope/tool @scope/tool',
  ]);
});

test('no globals means no install commands', () => {
  expect(globalInstallCommands({ npmGlobals: [] })).toEqual([]);
});

test('extra apt packages are added after the feature packages without duplicates', () => {
  const list = aptPackageList({ features: DEFAULT_FEATURES, extra: ['cargo', 'git'] });
  expect(list.at(-1)).toBe('cargo');
  expect(list.filter((pkg) => pkg === 'git')).toHaveLength(1);
});

test('a python-only image drops every optional package and command', () => {
  const apt = aptPackageList({ features: [], extra: [] });
  expect(apt).toEqual(TODAYS_APT_PACKAGES.slice(0, 9));
  const commands = rootCommands({ features: [], nodeMajor: 24, npmGlobals: [] });
  expect(commands).toEqual([
    'id user >/dev/null 2>&1 || useradd -m -s /bin/bash user',
    "echo 'user ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/user",
    'rm -rf /var/lib/apt/lists/*',
  ]);
});

test('feature order in the list does not change the output', () => {
  expect(rootCommands({ features: [...DEFAULT_FEATURES].reverse(), nodeMajor: 24, npmGlobals: [] })).toEqual(
    TODAYS_ROOT_COMMANDS
  );
});

test('the node major version is configurable', () => {
  const commands = rootCommands({ features: ['node'], nodeMajor: 22, npmGlobals: [] });
  expect(commands[0]).toBe('curl -fsSL https://deb.nodesource.com/setup_22.x | bash -');
});
