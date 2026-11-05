/** One-line advice for a snapshot older than the threshold, or null. */
export function staleSnapshotHint({
  repo,
  createdAt,
  now,
  thresholdHours,
}: {
  repo: string;
  createdAt: Date | null;
  now: Date;
  thresholdHours: number;
}) {
  if (!createdAt) return null;
  const ageHours = (now.getTime() - createdAt.getTime()) / 3_600_000;
  if (ageHours <= thresholdHours) return null;
  return `snapshot for ${repo} is ${formatAge({ hours: ageHours })} old, so up is slower than it needs to be; re-bake with: l2b bake ${repo}`;
}

export function formatAge({ hours }: { hours: number }) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}
