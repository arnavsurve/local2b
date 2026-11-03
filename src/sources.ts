import type { Context } from './context';
import { parseDopplerTarget, type SecretSource } from './secrets';

export function secretSourcesFor({
  ctx,
  doppler,
}: {
  ctx: Context;
  doppler: string | null;
}): SecretSource[] {
  const extra = doppler ? [parseDopplerTarget(doppler)] : [];
  return [...ctx.config.secrets, ...extra];
}

export function resolveImage({
  ctx,
  override,
}: {
  ctx: Context;
  override: string | null;
}) {
  return override ?? ctx.config.image ?? ctx.provider.defaultImage;
}
