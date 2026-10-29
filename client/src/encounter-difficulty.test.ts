import { describe, expect, it } from 'vitest';
import { encounterDifficulty } from './encounter-difficulty';

describe('encounterDifficulty (DMG 2014)', () => {
  it('applies the group multiplier and party thresholds', () => {
    // 4 thugs: 400 XP x2 = 800, exactly deadly for four level-2 characters.
    expect(encounterDifficulty([{ cr: '1/2', count: 4 }], 4, 2)).toMatchObject({ xp: 400, adjusted: 800, difficulty: '致命' });
    // 2 grells: 1400 x1.5 = 2100, medium for four level-5 characters.
    expect(encounterDifficulty([{ cr: '3', count: 2 }], 4, 5)).toMatchObject({ adjusted: 2100, difficulty: '中等' });
    // One gazer is below the easy threshold for level 3.
    expect(encounterDifficulty([{ cr: '1/2', count: 1 }], 4, 3)?.difficulty).toBe('轻松');
  });

  it('shifts the multiplier for small and large parties', () => {
    expect(encounterDifficulty([{ cr: '1', count: 1 }], 2, 1)?.adjusted).toBe(300);
    expect(encounterDifficulty([{ cr: '1', count: 3 }], 6, 3)?.adjusted).toBe(900);
  });

  it('ignores scenery without a CR and returns null when nothing has one', () => {
    expect(encounterDifficulty([{ cr: '—', count: 1 }], 4, 4)).toBeNull();
    expect(encounterDifficulty([{ cr: '2', count: 1 }, { cr: '—', count: 1 }], 4, 4)).toMatchObject({ xp: 450, adjusted: 450 });
  });
});
