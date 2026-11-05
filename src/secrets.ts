import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { z } from 'zod';
import { shellQuote } from './shell';

const DEFAULT_TIMEOUT_MS = 30_000;
const STDERR_CAP = 500;

const argvSchema = z.array(z.string()).min(1);
const timeoutSchema = z.number().int().positive().default(DEFAULT_TIMEOUT_MS);
const formatSchema = z.enum(['json', 'dotenv']);
type Format = z.infer<typeof formatSchema>;

export const valueRefSchema = z.discriminatedUnion('from', [
  z.object({ from: z.literal('env'), name: z.string() }),
  z.object({
    from: z.literal('doppler'),
    project: z.string(),
    config: z.string(),
    name: z.string(),
  }),
  z.object({ from: z.literal('command'), argv: argvSchema, timeoutMs: timeoutSchema }),
  z.object({ from: z.literal('file'), path: z.string() }),
]);
export type ValueRef = z.infer<typeof valueRefSchema>;

/** A bundle of variables injected into every sandbox. */
export const secretSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('doppler'),
    project: z.string(),
    config: z.string(),
  }),
  z.object({ type: z.literal('env'), names: z.array(z.string()) }),
  z.object({
    type: z.literal('command'),
    argv: argvSchema,
    format: formatSchema,
    timeoutMs: timeoutSchema,
  }),
  z.object({ type: z.literal('file'), path: z.string(), format: formatSchema }),
]);
export type SecretSource = z.infer<typeof secretSourceSchema>;

export function parseDopplerTarget(spec: string): SecretSource {
  const [project, config] = spec.split('/');
  if (!project || !config) {
    throw new Error(`doppler target must be <project>/<config>, got "${spec}"`);
  }
  return { type: 'doppler', project, config };
}

export function dopplerArgv({ project, config }: { project: string; config: string }) {
  return [
    'doppler', 'secrets', 'download', '--no-file', '--format', 'json',
    '--project', project, '--config', config,
  ];
}

/** Replaces a leading `~` with the home directory. */
export function expandHome(path: string) {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

/** Drops a single trailing newline (CRLF or LF), as printed by most credential CLIs. */
export function trimOneNewline(text: string) {
  if (text.endsWith('\r\n')) return text.slice(0, -2);
  if (text.endsWith('\n')) return text.slice(0, -1);
  return text;
}

/**
 * Parses `json` (flat object of strings) or `dotenv` text into variables.
 * Errors name keys and origins only, never values.
 */
export function parseVariables({
  text,
  format,
  origin,
}: {
  text: string;
  format: Format;
  origin: string;
}): Record<string, string> {
  switch (format) {
    case 'dotenv':
      return parse(text);
    case 'json': {
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`${origin}: output is not valid JSON`);
      }
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new Error(`${origin}: JSON output must be an object of string values`);
      }
      const vars: Record<string, string> = {};
      for (const [key, value] of Object.entries(data)) {
        if (typeof value !== 'string') {
          throw new Error(`${origin}: JSON value for ${key} must be a string`);
        }
        vars[key] = value;
      }
      return vars;
    }
    default: {
      const unreachable: never = format;
      throw new Error(`unknown format: ${String(unreachable)}`);
    }
  }
}

/**
 * Runs argv directly (no shell) with the current environment and returns stdout.
 * Failures report the binary, exit code and capped stderr, never stdout.
 */
async function runCommand({ argv, timeoutMs }: { argv: string[]; timeoutMs: number }) {
  const [bin = ''] = argv;
  let proc: ReturnType<typeof Bun.spawn<'ignore', 'pipe', 'pipe'>>;
  try {
    proc = Bun.spawn(argv, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`${bin} not found on PATH`);
    }
    throw new Error(`could not run ${bin}: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill('SIGKILL');
  }, timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (timedOut) throw new Error(`${bin} timed out after ${timeoutMs}ms`);
    if (code !== 0) {
      throw new Error(`${bin} exited with code ${code}: ${stderr.trim().slice(0, STDERR_CAP)}`);
    }
    return stdout;
  } finally {
    clearTimeout(timer);
  }
}

async function readSecretFile(path: string) {
  const file = Bun.file(expandHome(path));
  if (!(await file.exists())) throw new Error(`secrets file not found: ${path}`);
  return file.text();
}

async function commandVariables({
  argv,
  timeoutMs,
  format,
}: {
  argv: string[];
  timeoutMs: number;
  format: Format;
}) {
  const text = await runCommand({ argv, timeoutMs });
  return parseVariables({ text, format, origin: argv[0] ?? 'command' });
}

export async function loadSecrets(source: SecretSource) {
  switch (source.type) {
    case 'doppler':
      return commandVariables({
        argv: dopplerArgv(source),
        timeoutMs: DEFAULT_TIMEOUT_MS,
        format: 'json',
      });
    case 'command':
      return commandVariables(source);
    case 'file':
      return parseVariables({
        text: await readSecretFile(source.path),
        format: source.format,
        origin: source.path,
      });
    case 'env': {
      const vars: Record<string, string> = {};
      for (const name of source.names) {
        const value = process.env[name];
        if (value === undefined) throw new Error(`env var ${name} is not set`);
        vars[name] = value;
      }
      return vars;
    }
    default: {
      const unreachable: never = source;
      throw new Error(`unknown secret source: ${JSON.stringify(unreachable)}`);
    }
  }
}

export async function resolveValue(ref: ValueRef) {
  switch (ref.from) {
    case 'env': {
      const value = process.env[ref.name];
      if (!value) throw new Error(`env var ${ref.name} is not set`);
      return value;
    }
    case 'doppler': {
      const vars = await loadSecrets({ type: 'doppler', project: ref.project, config: ref.config });
      const value = vars[ref.name];
      if (!value) throw new Error(`${ref.name} missing in doppler ${ref.project}/${ref.config}`);
      return value;
    }
    case 'command': {
      const value = trimOneNewline(await runCommand(ref));
      if (!value) throw new Error(`${ref.argv[0]} printed empty output`);
      return value;
    }
    case 'file': {
      const value = trimOneNewline(await readSecretFile(ref.path));
      if (!value) throw new Error(`secrets file ${ref.path} is empty`);
      return value;
    }
    default: {
      const unreachable: never = ref;
      throw new Error(`unknown value ref: ${JSON.stringify(unreachable)}`);
    }
  }
}

export function toEnvFile(vars: Record<string, string>) {
  return Object.entries(vars)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join('\n')
    .concat('\n');
}
