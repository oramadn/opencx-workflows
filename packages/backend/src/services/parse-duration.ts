const UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a compact duration string (e.g. "30s", "5m", "1h", "1d") into
 * milliseconds.  Returns 0 for unparseable input.
 */
export function parseDuration(input: string): number {
  const match = input.trim().match(/^(\d+)\s*(ms|s|m|h|d)$/);
  if (!match) return 0;
  return Number(match[1]) * (UNITS[match[2]!] ?? 0);
}
