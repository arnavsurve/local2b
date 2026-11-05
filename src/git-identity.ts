import type { GitIdentity } from './providers/types';

/** The config override wins; otherwise the local global git identity. `null` when either part is unset. */
export async function resolveGitIdentity({ override }: { override: GitIdentity | null }) {
  if (override) return override;
  const read = async (key: string) => {
    const proc = Bun.spawn(['git', 'config', '--global', '--get', key], {
      stdout: 'pipe',
      stderr: 'ignore',
      env: process.env,
    });
    const text = (await new Response(proc.stdout).text()).trim();
    return (await proc.exited) === 0 && text ? text : null;
  };
  const [name, email] = await Promise.all([read('user.name'), read('user.email')]);
  return name && email ? { name, email } : null;
}
