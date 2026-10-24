// Chat roll notation shared by the room (which rolls) and the browser (which
// validates before sending). Examples: d20, 2d6+3, 1d8+1d6-1, 2d20kh1 (advantage),
// 2d20kl1 (disadvantage), 4d6kh3.

export interface DiceTermSpec {
  sign: 1 | -1;
  count: number;
  faces: number;
  keep?: { mode: 'h' | 'l'; count: number };
}

export interface ParsedRoll {
  terms: DiceTermSpec[];
  modifier: number;
  /** Normalized notation, e.g. "2d20kh1+3". */
  formula: string;
}

export interface RolledDice {
  formula: string;
  /** Every die rolled, in term order. */
  rolls: number[];
  /** Indices into rolls that a keep-highest/lowest term discarded. */
  dropped: number[];
  total: number;
}

export const DICE_LIMITS = { terms: 12, dice: 100, faces: 1_000, modifier: 10_000 } as const;

const TERM = /^(\d*)d(\d+)(?:k([hl])(\d+))?$|^(\d+)$/i;

/** Parse a roll expression, or null when it is not valid notation or exceeds the limits. */
export function parseRollNotation(input: string): ParsedRoll | null {
  const source = input.replace(/\s+/g, '').toLowerCase();
  if (!source || !/^[+-]?[0-9dkhl]+(?:[+-][0-9dkhl]+)*$/.test(source)) return null;
  const parts = source.match(/[+-]?[^+-]+/g) ?? [];
  if (parts.length > DICE_LIMITS.terms) return null;
  const terms: DiceTermSpec[] = [];
  let modifier = 0;
  let dice = 0;
  for (const part of parts) {
    const sign: 1 | -1 = part.startsWith('-') ? -1 : 1;
    const match = TERM.exec(part.replace(/^[+-]/, ''));
    if (!match) return null;
    if (match[5] !== undefined) {
      modifier += sign * Number(match[5]);
      continue;
    }
    const count = match[1] ? Number(match[1]) : 1;
    const faces = Number(match[2]);
    if (count < 1 || faces < 2 || faces > DICE_LIMITS.faces) return null;
    dice += count;
    const term: DiceTermSpec = { sign, count, faces };
    if (match[3]) {
      const keep = Number(match[4]);
      if (keep < 1 || keep > count) return null;
      term.keep = { mode: match[3] as 'h' | 'l', count: keep };
    }
    terms.push(term);
  }
  if (!terms.length || dice > DICE_LIMITS.dice || Math.abs(modifier) > DICE_LIMITS.modifier) return null;
  const formula = [
    ...terms.map((term, index) => `${term.sign < 0 ? '-' : index ? '+' : ''}${term.count}d${term.faces}${term.keep ? `k${term.keep.mode}${term.keep.count}` : ''}`),
    modifier ? (modifier > 0 ? `+${modifier}` : String(modifier)) : '',
  ].join('');
  return { terms, modifier, formula };
}

/** Roll a parsed expression with the supplied uniform die (1..faces). */
export function rollNotation(parsed: ParsedRoll, die: (faces: number) => number): RolledDice {
  const rolls: number[] = [];
  const dropped: number[] = [];
  let total = parsed.modifier;
  for (const term of parsed.terms) {
    const start = rolls.length;
    const values = Array.from({ length: term.count }, () => die(term.faces));
    rolls.push(...values);
    let kept = values.map((_, index) => index);
    if (term.keep) {
      const ranked = [...kept].sort((a, b) => term.keep!.mode === 'h' ? values[b] - values[a] : values[a] - values[b]);
      const keep = new Set(ranked.slice(0, term.keep.count));
      kept = kept.filter(index => keep.has(index));
      for (let index = 0; index < values.length; index += 1) if (!keep.has(index)) dropped.push(start + index);
    }
    total += term.sign * kept.reduce((sum, index) => sum + values[index], 0);
  }
  return { formula: parsed.formula, rolls, dropped, total };
}

/** The expression after a /r or /roll chat command, or null for ordinary chat. */
export function chatRollExpression(text: string): string | null {
  const match = /^\/(?:r|roll)(?:\s+(.*))?$/iu.exec(text.trim());
  return match ? (match[1] ?? '').trim() : null;
}
