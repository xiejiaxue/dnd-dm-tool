export interface FormulaRollGroup {
  sign: 1 | -1;
  count: number;
  sides: number;
  rolls: number[];
  subtotal: number;
}

export interface FormulaRollResult {
  formula: string;
  groups: FormulaRollGroup[];
  modifier: number;
  total: number;
}

export type D20Mode = 'normal' | 'advantage' | 'disadvantage';

/** A deliberately small, auditable tabletop formula grammar. It supports
 * signed dice terms and integer modifiers without evaluating JavaScript. */
export function rollFormulaExpression(
  input: string,
  mode: D20Mode = 'normal',
  random: () => number = secureRandom,
): FormulaRollResult {
  const formula = input.replace(/\s+/gu, '');
  if (!formula || formula.length > 200 || !/^[+-]?(?:\d{1,3}d\d{1,4}|\d{1,6})(?:[+-](?:\d{1,3}d\d{1,4}|\d{1,6}))*$/iu.test(formula)) {
    throw new Error('骰子公式无效，例如 1d20+5 或 2d6+1d4+3');
  }
  const terms = formula.match(/[+-]?[^+-]+/gu) ?? [];
  const groups: FormulaRollGroup[] = [];
  let modifier = 0;
  for (const term of terms) {
    const sign: 1 | -1 = term.startsWith('-') ? -1 : 1;
    const body = term.replace(/^[+-]/u, '');
    const dice = /^(\d{1,3})d(\d{1,4})$/iu.exec(body);
    if (!dice) {
      modifier += sign * Number(body);
      continue;
    }
    let count = Number(dice[1]);
    const sides = Number(dice[2]);
    if (count < 1 || count > 100 || sides < 2 || sides > 1000) throw new Error('骰子数量或面数超出范围');
    const d20Mode = sides === 20 && count === 1 ? mode : 'normal';
    if (d20Mode !== 'normal') count = 2;
    const samples = Array.from({ length: count }, () => Math.floor(clampRandom(random()) * sides) + 1);
    const rolls = d20Mode === 'advantage' ? [Math.max(...samples)] : d20Mode === 'disadvantage' ? [Math.min(...samples)] : samples;
    groups.push({ sign, count: rolls.length, sides, rolls, subtotal: sign * rolls.reduce((sum, value) => sum + value, 0) });
  }
  return { formula, groups, modifier, total: groups.reduce((sum, group) => sum + group.subtotal, modifier) };
}

export function secureRandom(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0x1_0000_0000;
}

function clampRandom(value: number): number {
  return Math.max(0, Math.min(0.9999999999999999, value));
}

