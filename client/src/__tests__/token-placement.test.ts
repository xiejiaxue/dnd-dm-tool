import { describe, expect, it } from 'vitest';
import { nextTokenSpawn } from '../tokenPlacement';

describe('one-click token placement', () => {
  it('starts in the visible top-left zone even on a large map', () => {
    expect(nextTokenSpawn({
      playArea: { x: 0, y: 0, w: 3000, h: 1600 },
      tokens: [],
    })).toEqual({ x: 100, y: 100 });
  });

  it('tiles all monster types without stacking them on one point', () => {
    expect(nextTokenSpawn({
      playArea: { x: 20, y: 30, w: 1600, h: 1200 },
      tokens: Array.from({ length: 6 }),
    })).toEqual({ x: 230, y: 240 });
  });

  it('stays inside a play area smaller than the normal inset', () => {
    expect(nextTokenSpawn({
      playArea: { x: 10, y: 20, w: 80, h: 60 },
      tokens: Array.from({ length: 12 }),
    })).toEqual({ x: 50, y: 50 });
  });
});
