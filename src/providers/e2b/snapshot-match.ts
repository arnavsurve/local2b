/** `[team/]name[:tag]` without the team and the tag. */
const bareName = (full: string) => (full.split(':')[0] ?? '').split('/').pop() ?? '';

/**
 * True when one of the snapshot's full names (`[team/]name[:tag]`) has exactly
 * the wanted name, so `l2b-acme-api` never matches `l2b-other-acme-api`.
 */
export function snapshotHasName({ names, name }: { names: string[]; name: string }) {
  return names.some((full) => bareName(full) === name);
}

/** The bare `l2b-` name of a snapshot l2b made for a repo, or null for any other snapshot. */
export function l2bSnapshotName({ names }: { names: string[] }) {
  return names.map(bareName).find((name) => name.startsWith('l2b-')) ?? null;
}
