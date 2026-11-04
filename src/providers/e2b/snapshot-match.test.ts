import { expect, test } from 'bun:test';
import { snapshotHasName } from './snapshot-match';

test('matches the exact name under any team prefix and tag', () => {
  expect(snapshotHasName({ names: ['team/l2b-acme-api:default'], name: 'l2b-acme-api' })).toBe(true);
  expect(snapshotHasName({ names: ['l2b-acme-api'], name: 'l2b-acme-api' })).toBe(true);
});

test('does not match a name that merely ends with the wanted one', () => {
  expect(snapshotHasName({ names: ['team/l2b-other-acme-api:default'], name: 'l2b-acme-api' })).toBe(false);
  expect(snapshotHasName({ names: ['team/xl2b-acme-api'], name: 'l2b-acme-api' })).toBe(false);
});
