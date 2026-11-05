import type { Context } from './context';
import { resolveCredentials } from './credentials';
import { resolveGitIdentity } from './git-identity';
import type { ExecOutput, StartOpts } from './providers/types';
import { repoSpecFor } from './repo';
import { staleSnapshotHint } from './snapshots';

/** What `up` and `run` ask the provider for. A `fresh` start (`--full`) ignores any bake and keeps the whole history. */
export async function startOptsFor({
  ctx,
  name,
  repo,
  branch,
  source,
  install,
  doppler,
  image,
}: {
  ctx: Context;
  name: string;
  repo: string | null;
  branch: string | null;
  source: StartOpts['source'];
  install: string | null;
  doppler: string | null;
  image: string | null;
}): Promise<StartOpts> {
  const spec = repo ? repoSpecFor({ config: ctx.config, repo, install, warm: null, baseBranch: null }) : null;
  return {
    name,
    repo: spec && source === 'fresh' ? { ...spec, clone: { ...spec.clone, depth: null } } : spec,
    branch,
    source,
    image: image ?? ctx.config.image,
    idle: { minutes: ctx.config.idle.minutes },
    credentials: await resolveCredentials({ config: ctx.config, repo, doppler }),
    gitIdentity: await resolveGitIdentity({ override: ctx.config.gitIdentity }),
  };
}

/** Prints the re-bake hint when the box will start from a bake older than `staleSnapshotHours`. */
export async function warnIfStale({ ctx, start }: { ctx: Context; start: StartOpts }) {
  if (!start.repo || start.source !== 'bake') return;
  const hint = staleSnapshotHint({
    repo: `${start.repo.owner}/${start.repo.name}`,
    createdAt: await ctx.provider.bakedAt({ repo: start.repo }),
    now: new Date(),
    thresholdHours: ctx.config.staleSnapshotHours,
  });
  if (hint) console.error(`l2b: ${hint}`);
}

/** Streams a box command's output to this process. */
export function toProcess({ stream, data }: ExecOutput) {
  (stream === 'stdout' ? process.stdout : process.stderr).write(data);
}
