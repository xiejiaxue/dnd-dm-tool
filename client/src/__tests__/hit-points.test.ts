import { describe, expect, it } from 'vitest';
import { hitPointPercentage, initialHitPoints, parseHitPointDraft } from '../features/hit-points/model';

describe('enemy hit points', () => {
  it('initializes both current and max from the compendium average', () => {
    expect(initialHitPoints(7)).toEqual({ current: 7, max: 7 });
    expect(initialHitPoints(7.4)).toEqual({ current: 7, max: 7 });
    expect(initialHitPoints(undefined)).toBeUndefined();
    expect(initialHitPoints(0)).toBeUndefined();
  });

  it('validates current and max as one draft', () => {
    expect(parseHitPointDraft('3', '9')).toEqual({ hp: { current: 3, max: 9 } });
    expect(parseHitPointDraft('10', '9')).toEqual({ error: '当前 HP 必须在 0 到 9 之间' });
    expect(parseHitPointDraft('-1', '9')).toEqual({ error: '当前 HP 和最大 HP 必须是整数' });
    expect(parseHitPointDraft('3', '0')).toEqual({ error: '最大 HP 必须在 1 到 100000 之间' });
    expect(parseHitPointDraft('3.5', '9')).toEqual({ error: '当前 HP 和最大 HP 必须是整数' });
  });

  it('clamps the health bar to a renderable percentage', () => {
    expect(hitPointPercentage({ current: 3, max: 12 })).toBe(25);
    expect(hitPointPercentage({ current: 15, max: 12 })).toBe(100);
    expect(hitPointPercentage({ current: -2, max: 12 })).toBe(0);
  });
});
