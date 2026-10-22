/**
 * A minimal dice-expression engine for the session calculator: terms joined
 * by + and -, where each term is an integer or XdY. No dependency, fully
 * deterministic under an injected rng so tests can pin the outcomes.
 */

export interface DiceTerm {
  sign: 1 | -1;
  /** Dice terms carry count/faces; constant terms carry value instead. */
  count: number | null;
  faces: number | null;
  value: number;
}

const MAX_DICE = 200;
const MAX_FACES = 1000;

export function parseDice(input: string): DiceTerm[] | null {
  const s = input.toLowerCase().replace(/\s+/g, '');
  if (!s || !/^[+-]?[0-9d]/.test(s)) return null;
  const terms: DiceTerm[] = [];
  let sign: 1 | -1 = 1;
  let i = 0;
  if (s[0] === '+') i = 1;
  else if (s[0] === '-') { sign = -1; i = 1; }
  while (i < s.length) {
    const die = /^(\d+)?d(\d+)/.exec(s.slice(i));
    if (die) {
      const count = die[1] ? Number(die[1]) : 1;
      const faces = Number(die[2]);
      if (count < 1 || count > MAX_DICE || faces < 2 || faces > MAX_FACES) return null;
      terms.push({ sign, count, faces, value: 0 });
      i += die[0].length;
    } else {
      const constant = /^\d+/.exec(s.slice(i));
      if (!constant) return null;
      terms.push({ sign, count: null, faces: null, value: Number(constant[0]) });
      i += constant[0].length;
    }
    if (i >= s.length) break;
    if (s[i] === '+') sign = 1;
    else if (s[i] === '-') sign = -1;
    else return null;
    // A trailing operator ("2d6+") must not parse as a complete expression.
    if (++i >= s.length) return null;
  }
  return terms;
}

export interface DiceGroup { count: number; faces: number; values: number[] }
export interface RollResult {
  total: number;
  groups: DiceGroup[];
  /** Human-readable breakdown, e.g. "[4, 2] + 3". */
  detail: string;
}

export function rollTerms(terms: DiceTerm[], rand: () => number = Math.random): RollResult {
  const groups: DiceGroup[] = [];
  const parts: string[] = [];
  let total = 0;
  for (const term of terms) {
    if (term.count == null || term.faces == null) {
      total += term.sign * term.value;
      parts.push(`${term.sign < 0 ? '-' : '+'} ${term.value}`);
      continue;
    }
    const values = Array.from({ length: term.count }, () => 1 + Math.floor(rand() * term.faces!));
    const sign = term.sign;
    total += sign * values.reduce((a, b) => a + b, 0);
    groups.push({ count: term.count, faces: term.faces, values });
    const body = values.length === 1 ? String(values[0]) : `[${values.join(', ')}]`;
    parts.push(`${sign < 0 ? '-' : '+'} ${body}`);
  }
  const detail = parts.join(' ').replace(/^[+-] /, '');
  return { total, groups, detail };
}

export function rollExpression(input: string, rand: () => number = Math.random): RollResult | null {
  const terms = parseDice(input);
  return terms ? rollTerms(terms, rand) : null;
}
