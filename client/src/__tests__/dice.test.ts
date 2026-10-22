import { describe, expect, it } from 'vitest';
import { adjustDice, diceCount, emptyDicePool, formatDicePool, rollDicePool } from '../features/dice/model';

describe('dice tray', () => {
  it('builds 6d6 by clicking d6 six times', () => {
    let pool = emptyDicePool();
    for (let index = 0; index < 6; index += 1) pool = adjustDice(pool, 6, 1);

    expect(diceCount(pool)).toBe(6);
    expect(formatDicePool(pool)).toBe('6d6');
  });

  it('combines different dice types and removes dice without going below zero', () => {
    let pool = adjustDice(emptyDicePool(), 20, 2);
    pool = adjustDice(pool, 6, 3);
    pool = adjustDice(pool, 20, -1);
    pool = adjustDice(pool, 4, -10);

    expect(formatDicePool(pool)).toBe('3d6 + 1d20');
    expect(diceCount(pool)).toBe(4);
  });

  it('returns each die result, subtotals, and the grand total', () => {
    let pool = adjustDice(emptyDicePool(), 6, 2);
    pool = adjustDice(pool, 20, 1);
    const samples = [0, 0.999, 0.5];
    const result = rollDicePool(pool, () => samples.shift() ?? 0);

    expect(result).toEqual({
      formula: '2d6 + 1d20',
      groups: [
        { sides: 6, results: [1, 6], subtotal: 7 },
        { sides: 20, results: [11], subtotal: 11 },
      ],
      total: 18,
    });
  });

  it('does not roll an empty pool', () => {
    expect(rollDicePool(emptyDicePool())).toBeNull();
  });
});
