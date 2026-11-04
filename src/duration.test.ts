import { expect, test } from 'bun:test';
import { parseDuration } from './duration';

test('parses minutes, hours, days and weeks into milliseconds', () => {
  expect(parseDuration('30m')).toBe(30 * 60_000);
  expect(parseDuration('12h')).toBe(12 * 3_600_000);
  expect(parseDuration('2d')).toBe(2 * 86_400_000);
  expect(parseDuration('1w')).toBe(7 * 86_400_000);
  expect(parseDuration('1.5h')).toBe(5_400_000);
});

test.each(['', '12', 'h', '-1h', '1x', '1 h', '0h'])('rejects %p', (input) => {
  expect(() => parseDuration(input)).toThrow('bad duration');
});
