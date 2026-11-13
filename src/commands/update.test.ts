import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assetName, updateBinary } from './update';

const ASSET = 'l2b-linux-x64';
let dir = '';
let server: ReturnType<typeof Bun.serve>;
let files: Record<string, string> = {};
let tag = 'v9.9.9';

function sha256(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'l2b-update-'));
  files = { [ASSET]: 'new binary', 'l2b-darwin-arm64': 'mac binary' };
  files.SHA256SUMS = Object.entries(files)
    .map(([name, content]) => `${sha256(content)}  ${name}\n`)
    .join('');
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === '/releases/latest') {
        return Response.json({
          tag_name: tag,
          assets: Object.keys(files).map((name) => ({ name, browser_download_url: `${server.url}download/${name}` })),
        });
      }
      const name = path.replace('/download/', '');
      return name in files ? new Response(files[name]) : new Response('not found', { status: 404 });
    },
  });
});

afterEach(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

function target() {
  const path = join(dir, 'l2b');
  writeFileSync(path, 'old binary', { mode: 0o755 });
  return path;
}

const release = () => `${server.url}releases/latest`;

test('asset names cover the released platforms and reject others', () => {
  expect(assetName({ platform: 'darwin', arch: 'arm64' })).toBe('l2b-darwin-arm64');
  expect(assetName({ platform: 'darwin', arch: 'x64' })).toBe('l2b-darwin-x64');
  expect(assetName({ platform: 'linux', arch: 'x64' })).toBe('l2b-linux-x64');
  expect(assetName({ platform: 'linux', arch: 'arm64' })).toBe('l2b-linux-arm64');
  expect(() => assetName({ platform: 'win32', arch: 'x64' })).toThrow('no l2b release for win32-x64');
});

test('replaces the binary with the verified release asset', async () => {
  const path = target();
  const result = await updateBinary({ releaseUrl: release(), target: path, current: '0.1.0', asset: ASSET });
  expect(result).toEqual({ updated: true, version: '9.9.9' });
  expect(readFileSync(path, 'utf8')).toBe('new binary');
  expect(statSync(path).mode & 0o777).toBe(0o755);
});

test('does nothing when already on the latest release', async () => {
  tag = 'v0.1.0';
  const path = target();
  const result = await updateBinary({ releaseUrl: release(), target: path, current: '0.1.0', asset: ASSET });
  expect(result).toEqual({ updated: false, version: '0.1.0' });
  expect(readFileSync(path, 'utf8')).toBe('old binary');
  tag = 'v9.9.9';
});

test('a checksum mismatch fails and leaves the binary alone', async () => {
  files[ASSET] = 'tampered';
  const path = target();
  await expect(updateBinary({ releaseUrl: release(), target: path, current: '0.1.0', asset: ASSET })).rejects.toThrow(
    'checksum mismatch',
  );
  expect(readFileSync(path, 'utf8')).toBe('old binary');
});

test('from source, update points at git and exits 0', async () => {
  const proc = Bun.spawn(['bun', resolve(import.meta.dir, '../cli.ts'), 'update'], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  expect(code).toBe(0);
  expect(stdout).toContain('git');
});
