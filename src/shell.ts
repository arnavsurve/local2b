export function shellQuote(arg: string) {
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

export function parentDir(path: string) {
  return path.replace(/\/[^/]+$/, '');
}
