import { expect, test } from 'bun:test';
import { detectInstall } from './install';

const cases: { name: string; files: string[]; command: string | null }[] = [
  { name: 'bun.lock', files: ['bun.lock', 'package.json'], command: 'bun install --frozen-lockfile' },
  { name: 'bun.lockb', files: ['bun.lockb', 'package.json'], command: 'bun install --frozen-lockfile' },
  { name: 'pnpm', files: ['pnpm-lock.yaml', 'package.json'], command: 'pnpm install --frozen-lockfile' },
  { name: 'yarn classic', files: ['yarn.lock', 'package.json'], command: 'yarn install --frozen-lockfile' },
  {
    name: 'yarn berry',
    files: ['yarn.lock', '.yarnrc.yml', 'package.json'],
    command: 'yarn install --immutable',
  },
  { name: 'npm ci', files: ['package-lock.json', 'package.json'], command: 'npm ci' },
  { name: 'package.json only', files: ['package.json', 'src'], command: 'npm install' },
  { name: 'bun beats pnpm', files: ['pnpm-lock.yaml', 'bun.lock', 'yarn.lock'], command: 'bun install --frozen-lockfile' },
  { name: 'pnpm beats yarn', files: ['yarn.lock', 'pnpm-lock.yaml', 'package-lock.json'], command: 'pnpm install --frozen-lockfile' },
  { name: 'yarn beats npm', files: ['package-lock.json', 'yarn.lock'], command: 'yarn install --frozen-lockfile' },
  { name: 'python', files: ['pyproject.toml', 'requirements.txt'], command: null },
  { name: 'go', files: ['go.mod', 'go.sum'], command: null },
  { name: 'empty', files: [], command: null },
];

test.each(cases)('detects $name', ({ files, command }) => {
  expect(detectInstall({ files })?.command ?? null).toBe(command);
});

test('the reason names the file that decided it', () => {
  expect(detectInstall({ files: ['yarn.lock', 'package.json'] })?.reason).toBe('yarn.lock');
});
