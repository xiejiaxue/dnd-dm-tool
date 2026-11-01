import { describe, expect, it } from 'vitest';
import { expectedPosition } from './table-music';

describe('shared table music', () => {
  const base = { playing: true, position: 10, updatedAt: 1_000_000, loop: false };
  it('advances a playing track from the room clock and holds a paused one', () => {
    expect(expectedPosition(base, 1_005_000, 100)).toBe(15);
    expect(expectedPosition({ ...base, playing: false }, 1_005_000, 100)).toBe(10);
    expect(expectedPosition(base, 990_000, 100)).toBe(10);
    expect(expectedPosition(base, 1_005_000, NaN)).toBe(15);
  });
  it('wraps a looping track and reports a finished one', () => {
    expect(expectedPosition({ ...base, loop: true }, 1_100_000, 60)).toBe(50);
    expect(expectedPosition(base, 1_100_000, 60)).toBeNull();
  });
});
