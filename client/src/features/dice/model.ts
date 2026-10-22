export const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;

export type DieSides = typeof DICE_SIDES[number];
export type DicePool = Record<DieSides, number>;

export interface DiceRollGroup {
  sides: DieSides;
  results: number[];
  subtotal: number;
}

export interface DiceRollResult {
  formula: string;
  groups: DiceRollGroup[];
  total: number;
}

const MAX_DICE_PER_TYPE = 99;

export function emptyDicePool(): DicePool {
  return { 4: 0, 6: 0, 8: 0, 10: 0, 12: 0, 20: 0, 100: 0 };
}

export function adjustDice(pool: DicePool, sides: DieSides, delta: number): DicePool {
  return {
    ...pool,
    [sides]: Math.max(0, Math.min(MAX_DICE_PER_TYPE, pool[sides] + delta)),
  };
}

export function diceCount(pool: DicePool): number {
  return DICE_SIDES.reduce((total, sides) => total + pool[sides], 0);
}

export function formatDicePool(pool: DicePool): string {
  return DICE_SIDES
    .filter(sides => pool[sides] > 0)
    .map(sides => `${pool[sides]}d${sides}`)
    .join(' + ');
}

export function rollDicePool(pool: DicePool, random: () => number = Math.random): DiceRollResult | null {
  const formula = formatDicePool(pool);
  if (!formula) return null;

  const groups = DICE_SIDES.flatMap<DiceRollGroup>((sides) => {
    const count = pool[sides];
    if (!count) return [];
    const results = Array.from({ length: count }, () => {
      const sample = Math.max(0, Math.min(0.9999999999999999, random()));
      return Math.floor(sample * sides) + 1;
    });
    return [{ sides, results, subtotal: results.reduce((sum, value) => sum + value, 0) }];
  });

  return {
    formula,
    groups,
    total: groups.reduce((sum, group) => sum + group.subtotal, 0),
  };
}
