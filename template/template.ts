import { Template } from 'e2b';

/**
 * Tooling-only image. It holds no repo and no credentials, so it is safe to
 * build once and share. The repo mirror is layered on afterwards by `l2b bake`
 * using the builder's own credentials, never baked into this image.
 */
export const template = Template()
  .fromUbuntuImage('24.04')
  .setUser('root')
  .aptInstall([
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
  ])
  .runCmd([
    'curl -fsSL https://deb.nodesource.com/setup_24.x | bash -',
    'apt-get install -y nodejs',
    'corepack enable && corepack prepare yarn@4.12.0 --activate',
    'npm install -g @earendil-works/pi-coding-agent bun || true',
    'curl -fsSL https://github.com/cli/cli/releases/download/v2.67.0/gh_2.67.0_linux_amd64.tar.gz | tar -xz -C /usr/local --strip-components=1',
    "curl -sLf --retry 3 --tlsv1.2 --proto '=https' 'https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key' | gpg --dearmor -o /usr/share/keyrings/doppler-archive-keyring.gpg",
    'echo "deb [signed-by=/usr/share/keyrings/doppler-archive-keyring.gpg] https://packages.doppler.com/public/cli/deb/debian any-version main" > /etc/apt/sources.list.d/doppler-cli.list',
    'apt-get update && apt-get install -y doppler',
    'curl -fsSL https://get.docker.com | sh',
    "id user >/dev/null 2>&1 || useradd -m -s /bin/bash user",
    "echo 'user ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/user",
    'usermod -aG docker user || true',
    'rm -rf /var/lib/apt/lists/*',
  ])
  .setUser('user')
  .setWorkdir('/home/user');
