const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;

/** Parses `30m`, `12h`, `2d` or `1w` into milliseconds. */
export function parseDuration(input: string) {
  const match = /^(\d+(?:\.\d+)?)([mhdw])$/.exec(input);
  const amount = match ? Number(match[1]) : 0;
  const unit = match?.[2];
  if (!match || !(amount > 0) || (unit !== 'm' && unit !== 'h' && unit !== 'd' && unit !== 'w')) {
    throw new Error(`bad duration "${input}", expected e.g. 30m, 12h, 2d, 1w`);
  }
  return amount * UNIT_MS[unit];
}
