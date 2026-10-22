import { describe, expect, it } from 'vitest';
import { parseDice, rollExpression, rollTerms } from '../dice';

describe('parseDice', () => {
  it('parses dice, constants and signs', () => {
    expect(parseDice('1d20+5')).toEqual([
      { sign: 1, count: 1, faces: 20, value: 0 },
      { sign: 1, count: null, faces: null, value: 5 },
    ]);
    expect(parseDice('2d6-1')).toEqual([
      { sign: 1, count: 2, faces: 6, value: 0 },
      { sign: -1, count: null, faces: null, value: 1 },
    ]);
    expect(parseDice(' 2d8 + 1d4 ')).toHaveLength(2);
    expect(parseDice('d20')).toEqual([{ sign: 1, count: 1, faces: 20, value: 0 }]);
    expect(parseDice('-3')).toEqual([{ sign: -1, count: null, faces: null, value: 3 }]);
  });

  it('rejects malformed or oversized expressions', () => {
    expect(parseDice('')).toBeNull();
    expect(parseDice('abc')).toBeNull();
    expect(parseDice('1d')).toBeNull();
    expect(parseDice('2d6+')).toBeNull();
    expect(parseDice('1d20x3')).toBeNull();
    expect(parseDice('0d6')).toBeNull();
    expect(parseDice('201d6')).toBeNull();
    expect(parseDice('1d1001')).toBeNull();
  });
});

describe('rollTerms', () => {
  const rand = () => 0; // every die lands on 1
  it('sums dice and constants with signs', () => {
    const result = rollTerms(parseDice('3d6+2-1')!, rand);
    expect(result.total).toBe(4); // 1+1+1 +2 -1
    expect(result.groups).toEqual([{ count: 3, faces: 6, values: [1, 1, 1] }]);
    expect(result.detail).toBe('[1, 1, 1] + 2 - 1');
  });

  it('respects the die floor of 1 with a high rand', () => {
    const result = rollTerms(parseDice('1d6')!, () => 0.999);
    expect(result.total).toBe(6);
  });
});

describe('rollExpression', () => {
  it('returns null for invalid input', () => {
    expect(rollExpression('nope')).toBeNull();
  });
});
