import { describe, expect, it } from 'vitest';
import { changeHp, nextTurn, parseQuickCombat, removeCombatEntry, sortInitiative, type CombatEntry } from '../quick-combat';
const fighter: CombatEntry = { id: 'a', name: '战士', initiative: 15, bonus: 2, hp: 20, maxHp: 30, tempHp: 5 };
describe('temporary combat calculations', () => {
  it('absorbs damage with temporary HP before HP and clamps at zero', () => {
    expect(changeHp(fighter, 8, 'damage')).toMatchObject({ hp: 17, tempHp: 0 });
    expect(changeHp(fighter, 100, 'damage')).toMatchObject({ hp: 0, tempHp: 0 });
  });
  it('caps healing and does not stack temporary HP', () => {
    expect(changeHp(fighter, 50, 'heal')).toMatchObject({ hp: 30, tempHp: 5 });
    expect(changeHp(fighter, 3, 'temporary').tempHp).toBe(5);
    expect(changeHp(fighter, 8, 'temporary').tempHp).toBe(8);
  });
  it('ignores negative and non-finite amounts', () => {
    expect(changeHp(fighter, -3, 'damage')).toEqual(fighter);
    expect(changeHp(fighter, NaN, 'damage')).toEqual(fighter);
  });
  it('sorts ties by bonus without mutating entries and wraps rounds', () => {
    const entries = [fighter, { ...fighter, id: 'b', bonus: 3 }];
    expect(sortInitiative(entries).map(entry => entry.id)).toEqual(['b', 'a']);
    expect(entries[0].id).toBe('a');
    const first = nextTurn({ entries, activeId: null, round: 1 });
    expect(first.activeId).toBe('b');
    expect(nextTurn(nextTurn(first))).toMatchObject({ activeId: 'b', round: 2 });
  });
  it('removes the active combatant without skipping the next actor', () => {
    const entries = [fighter, { ...fighter, id: 'b', initiative: 10 }];
    expect(removeCombatEntry({ entries, activeId: 'a', round: 1 }, 'a')).toMatchObject({ activeId: 'b', round: 1 });
    expect(removeCombatEntry({ entries: [fighter], activeId: 'a', round: 1 }, 'a')).toEqual({ entries: [], activeId: null, round: 1 });
  });
  it('recovers from malformed saved data and clamps stored values', () => {
    expect(parseQuickCombat('{')).toEqual({ entries: [], activeId: null, round: 1 });
    expect(parseQuickCombat(JSON.stringify({ entries: [{ ...fighter, hp: 100 }, fighter], activeId: 'missing', round: -3 }))).toMatchObject({ entries: [{ ...fighter, hp: 30 }], activeId: null, round: 1 });
  });
});
