import { describe, expect, it } from 'vitest';
import { chatRollExpression, parseRollNotation, rollNotation } from './dice-notation';

const sequence = (...values: number[]) => () => values.shift() ?? 1;

describe('dice notation', () => {
  it('normalizes single and multi-term expressions', () => {
    expect(parseRollNotation('d20')?.formula).toBe('1d20');
    expect(parseRollNotation(' 2D6 + 3 ')?.formula).toBe('2d6+3');
    expect(parseRollNotation('1d8+1d6-1')?.formula).toBe('1d8+1d6-1');
    expect(parseRollNotation('2d20kh1')?.formula).toBe('2d20kh1');
    expect(parseRollNotation('-1d4+5')?.formula).toBe('-1d4+5');
  });

  it('rejects invalid or oversized expressions', () => {
    for (const bad of ['', '5', 'd', '2d1', '2d20kh3', 'abc', '1d20+', '101d6', '1d1001', '1d6++2'])
      expect(parseRollNotation(bad), bad).toBeNull();
  });

  it('keeps the highest or lowest dice and reports the dropped ones', () => {
    expect(rollNotation(parseRollNotation('2d20kh1+2')!, sequence(4, 17))).toEqual({ formula: '2d20kh1+2', rolls: [4, 17], dropped: [0], total: 19 });
    expect(rollNotation(parseRollNotation('2d20kl1')!, sequence(4, 17))).toMatchObject({ dropped: [1], total: 4 });
    expect(rollNotation(parseRollNotation('1d8+1d6-1')!, sequence(5, 6))).toMatchObject({ rolls: [5, 6], dropped: [], total: 10 });
    expect(rollNotation(parseRollNotation('4d6kh3')!, sequence(1, 5, 3, 6))).toMatchObject({ dropped: [0], total: 14 });
  });

  it('recognizes chat roll commands', () => {
    expect(chatRollExpression('/r 2d6')).toBe('2d6');
    expect(chatRollExpression('/ROLL d20+1')).toBe('d20+1');
    expect(chatRollExpression('/r')).toBe('');
    expect(chatRollExpression('hello /r 2d6')).toBeNull();
    expect(chatRollExpression('/rest')).toBeNull();
  });
});
