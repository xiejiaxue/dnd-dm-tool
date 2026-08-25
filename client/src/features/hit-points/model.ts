import type { Token } from '../../types';

export type HitPoints = NonNullable<Token['hp']>;

export type HitPointDraftResult =
  | { hp: HitPoints; error?: never }
  | { hp?: never; error: string };

/** Build a fresh current/max pair from a compendium monster's average HP. */
export function initialHitPoints(maximum: number | undefined): HitPoints | undefined {
  if (typeof maximum !== 'number' || !Number.isFinite(maximum)) return undefined;
  const max = Math.round(maximum);
  return max >= 1 && max <= 100_000 ? { current: max, max } : undefined;
}

/** Validate the two values together so changing focus never submits half a form. */
export function parseHitPointDraft(currentText: string, maxText: string): HitPointDraftResult {
  if (!/^\d+$/u.test(currentText.trim()) || !/^\d+$/u.test(maxText.trim())) {
    return { error: '当前 HP 和最大 HP 必须是整数' };
  }
  const current = Number(currentText);
  const max = Number(maxText);
  if (max < 1 || max > 100_000) return { error: '最大 HP 必须在 1 到 100000 之间' };
  if (current < 0 || current > max) return { error: `当前 HP 必须在 0 到 ${max} 之间` };
  return { hp: { current, max } };
}

export function hitPointPercentage(hp: HitPoints | undefined): number {
  if (!hp) return 0;
  return Math.max(0, Math.min(100, (hp.current / hp.max) * 100));
}
