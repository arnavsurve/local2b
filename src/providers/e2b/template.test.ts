import { expect, test } from 'bun:test';
import { globalInstallCommands } from './template';

test('each global package gets its own install allowed to run its own scripts', () => {
  expect(globalInstallCommands({ npmGlobals: ['bun', '@scope/tool'] })).toEqual([
    'npm install -g --allow-scripts=bun bun',
    'npm install -g --allow-scripts=@scope/tool @scope/tool',
  ]);
});

test('no globals means no install commands', () => {
  expect(globalInstallCommands({ npmGlobals: [] })).toEqual([]);
});
