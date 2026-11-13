import { afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Commands write local records under XDG_STATE_HOME; keep every test off the real one.
let stateDir = '';

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'l2b-test-state-'));
  process.env.XDG_STATE_HOME = stateDir;
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});
