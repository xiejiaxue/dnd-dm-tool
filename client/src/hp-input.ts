/**
 * Read an HP field: a plain number sets the value, a leading sign applies
 * damage ("-7") or healing ("+5") to the current value, clamped to 0..max.
 * Returns null when the input is not a number.
 */
export function resolveHpInput(input: string, current: number | undefined, max: number): number | null {
  const text = input.trim();
  if (!/^[+-]?\d+$/.test(text)) return null;
  const value = Number(text);
  if (!/^[+-]/.test(text)) return value;
  return Math.min(max, Math.max(0, (current ?? max) + value));
}
