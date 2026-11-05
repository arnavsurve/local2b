import { randomBytes } from 'node:crypto';
import type { Box } from './providers/types';
import { shellQuote } from './shell';

export type JobStatus = { state: 'running' } | { state: 'exited'; exitCode: number };

/** Expanded by the box's shell; ids are checked to be shell-safe. */
const JOBS_ROOT = '"$HOME/.l2b-jobs"';

function jobDir({ id }: { id: string }) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`no job "${id}" (try: l2b jobs <name>)`);
  return `"$HOME/.l2b-jobs/${id}"`;
}

async function capture({ box, cmd, cwd }: { box: Box; cmd: string; cwd: string | null }) {
  let out = '';
  const exitCode = await box.exec({
    cmd,
    cwd,
    onOutput: ({ stream, data }) => {
      if (stream === 'stdout') out += data;
    },
  });
  return { exitCode, out };
}

/**
 * Starts `cmd` (already shell-quoted) in the background, detached from the
 * exec session so it outlives the tool call; it inherits the box env that
 * exec provides. Combined output goes to `log`; the exit code lands in
 * `status` only when the command finishes. `cwd` null is the box workdir.
 */
export async function startJob({ box, cwd, cmd }: { box: Box; cwd: string | null; cmd: string }) {
  const id = `${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`;
  const dir = jobDir({ id });
  const body = `(${cmd}) > ${dir}/log 2>&1; echo $? > ${dir}/status.tmp; mv ${dir}/status.tmp ${dir}/status`;
  const launch = [
    `mkdir -p ${dir}`,
    `printf %s ${shellQuote(cmd)} > ${dir}/cmd`,
    `if command -v setsid >/dev/null 2>&1; then S=setsid; else S=; fi`,
    `$S nohup bash -c ${shellQuote(body)} >/dev/null 2>&1 </dev/null &`,
  ].join('\n');
  const { exitCode } = await capture({ box, cwd, cmd: launch.replaceAll('\n', '; ') });
  if (exitCode !== 0) throw new Error(`could not start job (exit ${exitCode})`);
  return id;
}

const statusScript = ({ dir }: { dir: string }) =>
  `if [ -f ${dir}/status ]; then cat ${dir}/status; else echo running; fi`;

function parseStatus({ id, text }: { id: string; text: string }): JobStatus {
  const trimmed = text.trim();
  if (trimmed === 'running') return { state: 'running' };
  if (!/^\d+$/.test(trimmed)) throw new Error(`job ${id}: unreadable status file (got "${trimmed}")`);
  return { state: 'exited', exitCode: Number(trimmed) };
}

async function requireJob({ box, id }: { box: Box; id: string }) {
  const dir = jobDir({ id });
  const { exitCode } = await capture({ box, cwd: '/', cmd: `[ -d ${dir} ]` });
  if (exitCode !== 0) throw new Error(`no job "${id}" (try: l2b jobs <name>)`);
  return dir;
}

export async function jobStatus({ box, id }: { box: Box; id: string }) {
  const dir = await requireJob({ box, id });
  const { out } = await capture({ box, cwd: '/', cmd: statusScript({ dir }) });
  return parseStatus({ id, text: out });
}

export async function readLog({ box, id }: { box: Box; id: string }) {
  const dir = await requireJob({ box, id });
  const { out } = await capture({ box, cwd: '/', cmd: `cat ${dir}/log` });
  return out;
}

/** Streams the log until the job exits; resolves with the job's exit code. */
export async function followLog({ box, id }: { box: Box; id: string }) {
  const dir = await requireJob({ box, id });
  const script = [
    `tail -n +1 -f ${dir}/log & T=$!`,
    `while [ ! -f ${dir}/status ]; do sleep 1; done`,
    `sleep 1; kill $T 2>/dev/null; wait $T 2>/dev/null`,
    `exit $(cat ${dir}/status)`,
  ].join('; ');
  return box.exec({
    cmd: script,
    cwd: '/',
    onOutput: ({ stream, data }) => {
      (stream === 'stdout' ? process.stdout : process.stderr).write(data);
    },
  });
}

export async function listJobs({ box }: { box: Box }) {
  const script = `for d in ${JOBS_ROOT}/*/; do [ -d "$d" ] || continue; printf '%s\\t%s\\t%s\\n' "$(basename "$d")" "$(if [ -f "$d/status" ]; then cat "$d/status"; else echo running; fi)" "$(cat "$d/cmd" 2>/dev/null)"; done`;
  const { out } = await capture({ box, cwd: '/', cmd: script });
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [id = '', status = '', ...rest] = line.split('\t');
      return { id, ...parseStatus({ id, text: status }), cmd: rest.join('\t') };
    });
}
