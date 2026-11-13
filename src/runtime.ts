/** True inside a `bun build --compile` binary, whose modules live in Bun's embedded filesystem. */
export const COMPILED = import.meta.path.startsWith('/$bunfs/') || import.meta.path.startsWith('B:/~BUN/');
