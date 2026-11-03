export function requirePositional({
  positionals,
  index,
  usage,
}: {
  positionals: string[];
  index: number;
  usage: string;
}) {
  const value = positionals[index];
  if (!value) throw new Error(`usage: ${usage}`);
  return value;
}

/** Splits `a b -- c d` into `{ head: [a, b], tail: [c, d] }`. */
export function splitOnDoubleDash(args: string[]) {
  const sep = args.indexOf('--');
  if (sep === -1) return { head: args, tail: [] };
  return { head: args.slice(0, sep), tail: args.slice(sep + 1) };
}
