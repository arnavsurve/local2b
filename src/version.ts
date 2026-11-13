import pkg from '../package.json' with { type: 'json' };

/** Read from package.json; `bun build --compile` inlines it, so a binary carries its own version. */
export const VERSION: string = pkg.version;
