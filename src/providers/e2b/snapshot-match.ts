/**
 * True when one of the snapshot's full names (`[team/]name[:tag]`) has exactly
 * the wanted name, so `l2b-acme-api` never matches `l2b-other-acme-api`.
 */
export function snapshotHasName({ names, name }: { names: string[]; name: string }) {
  return names.some((full) => {
    const base = full.split(':')[0] ?? '';
    return base.split('/').pop() === name;
  });
}
