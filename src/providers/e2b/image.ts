import { z } from 'zod';

/** Optional tooling baked into the base image; each name maps to apt packages and/or install commands. */
export const featureSchema = z.enum(['node', 'gh', 'doppler', 'docker', 'postgres', 'redis', 'ripgrep', 'tmux']);
export type Feature = z.infer<typeof featureSchema>;

/** Everything the image shipped with before features were configurable. */
export const DEFAULT_FEATURES: Feature[] = featureSchema.options;

const CORE_APT_PACKAGES = [
  'git',
  'curl',
  'jq',
  'sudo',
  'ca-certificates',
  'gnupg',
  'build-essential',
  'python3',
  'python3-setuptools',
];

const FEATURE_APT_PACKAGES: Record<Feature, string[]> = {
  node: [],
  gh: [],
  doppler: [],
  docker: [],
  postgres: ['postgresql', 'postgresql-16-pgvector'],
  redis: ['redis-server'],
  ripgrep: ['ripgrep'],
  tmux: ['tmux'],
};

/** Canonical order, so the image does not depend on how the user ordered the list. */
function enabled({ features }: { features: Feature[] }) {
  return featureSchema.options.filter((feature) => features.includes(feature));
}

/**
 * One install per package: a package whose install scripts fail must not leave
 * the others half-installed. Recent npm blocks install scripts by default, so
 * each requested package is allowed to run its own (transitive scripts stay blocked).
 */
export function globalInstallCommands({ npmGlobals }: { npmGlobals: string[] }) {
  return npmGlobals.map((pkg) => `npm install -g --allow-scripts=${pkg} ${pkg}`);
}

export function aptPackageList({ features, extra }: { features: Feature[]; extra: string[] }) {
  const fromFeatures = enabled({ features }).flatMap((feature) => FEATURE_APT_PACKAGES[feature]);
  return [...new Set([...CORE_APT_PACKAGES, ...fromFeatures, ...extra])];
}

function featureCommands({ feature, nodeMajor, npmGlobals }: { feature: Feature; nodeMajor: number; npmGlobals: string[] }) {
  switch (feature) {
    case 'node':
      return [
        `curl -fsSL https://deb.nodesource.com/setup_${nodeMajor}.x | bash -`,
        'apt-get install -y nodejs',
        'corepack enable',
        ...globalInstallCommands({ npmGlobals }),
      ];
    case 'gh':
      return [
        'curl -fsSL https://github.com/cli/cli/releases/download/v2.67.0/gh_2.67.0_linux_amd64.tar.gz | tar -xz -C /usr/local --strip-components=1',
      ];
    case 'doppler':
      return [
        "curl -sLf --retry 3 --tlsv1.2 --proto '=https' 'https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key' | gpg --dearmor -o /usr/share/keyrings/doppler-archive-keyring.gpg",
        'echo "deb [signed-by=/usr/share/keyrings/doppler-archive-keyring.gpg] https://packages.doppler.com/public/cli/deb/debian any-version main" > /etc/apt/sources.list.d/doppler-cli.list',
        'apt-get update && apt-get install -y doppler',
      ];
    case 'docker':
      return ['curl -fsSL https://get.docker.com | sh'];
    case 'postgres':
    case 'redis':
    case 'ripgrep':
    case 'tmux':
      return [];
    default: {
      const unreachable: never = feature;
      return unreachable;
    }
  }
}

/** Root-user shell commands run after the apt packages, in order. */
export function rootCommands({
  features,
  nodeMajor,
  npmGlobals,
}: {
  features: Feature[];
  nodeMajor: number;
  npmGlobals: string[];
}) {
  const selected = enabled({ features });
  return [
    ...selected.flatMap((feature) => featureCommands({ feature, nodeMajor, npmGlobals })),
    'id user >/dev/null 2>&1 || useradd -m -s /bin/bash user',
    "echo 'user ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/user",
    ...(selected.includes('docker') ? ['usermod -aG docker user || true'] : []),
    'rm -rf /var/lib/apt/lists/*',
  ];
}
