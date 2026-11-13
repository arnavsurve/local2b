import { expect, test } from 'bun:test';
import { l2bSnapshotName, snapshotHasName } from './snapshot-match';

test('matches the exact name under any team prefix and tag', () => {
  expect(snapshotHasName({ names: ['team/l2b-acme-api:default'], name: 'l2b-acme-api' })).toBe(true);
  expect(snapshotHasName({ names: ['l2b-acme-api'], name: 'l2b-acme-api' })).toBe(true);
});

test('does not match a name that merely ends with the wanted one', () => {
  expect(snapshotHasName({ names: ['team/l2b-other-acme-api:default'], name: 'l2b-acme-api' })).toBe(false);
  expect(snapshotHasName({ names: ['team/xl2b-acme-api'], name: 'l2b-acme-api' })).toBe(false);
});

test('an l2b repo snapshot is known by its bare name; other snapshots have none', () => {
  expect(l2bSnapshotName({ names: ['other/thing:default', 'team/l2b-acme-api:default'] })).toBe('l2b-acme-api');
  expect(l2bSnapshotName({ names: ['team/my-snapshot:v2'] })).toBeNull();
});
