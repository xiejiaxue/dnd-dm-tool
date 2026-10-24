import { describe, expect, it } from 'vitest';
import { insertByValue, removeFromTurnOrder, stepTurn } from './initiative';
import type { InitiativeEntry, Token } from './types';

const entry = (id: string, active = false, tokenId: string | null = null, value = 10): InitiativeEntry =>
  ({ id, name: id, value, source: 'dm', sessionId: null, tokenId, active });
const monster = (id: string, current: number): Token =>
  ({ id, kind: 'monster', name: id, entryId: null, x: 0, y: 0, size: 50, avatar: '', color: '#fff', hp: { current, max: 10 } });
const scene = (initiative: InitiativeEntry[], round?: number, tokens: Token[] = []) => ({ initiative, round, tokens });
const activeId = (state: { initiative: InitiativeEntry[] }) => state.initiative.find(e => e.active)?.id ?? null;

describe('stepTurn', () => {
  it('starts round 1 and counts a new round on wrap', () => {
    const first = stepTurn(scene([entry('a'), entry('b')]), 1);
    expect([activeId(first), first.round]).toEqual(['a', 1]);
    const wrapped = stepTurn(scene([entry('a'), entry('b', true)], 1), 1);
    expect([activeId(wrapped), wrapped.round]).toEqual(['a', 2]);
  });

  it('steps back, returning to the previous round but never below 1', () => {
    const back = stepTurn(scene([entry('a', true), entry('b')], 3), -1);
    expect([activeId(back), back.round]).toEqual(['b', 2]);
    expect(stepTurn(scene([entry('a', true), entry('b')], 1), -1).round).toBe(1);
    // Nothing to undo before combat starts.
    expect(activeId(stepTurn(scene([entry('a'), entry('b')]), -1))).toBeNull();
  });

  it('skips defeated monsters unless everyone is defeated', () => {
    const tokens = [monster('t1', 0), monster('t2', 4)];
    const order = [entry('a', true), entry('b', false, 't1'), entry('c', false, 't2')];
    expect(activeId(stepTurn(scene(order, 1, tokens), 1))).toBe('c');
    const allDown = [monster('t1', 0), monster('t2', 0)];
    expect(activeId(stepTurn(scene([entry('b', true, 't1'), entry('c', false, 't2')], 1, allDown), 1))).toBe('c');
  });
});

describe('removeFromTurnOrder', () => {
  it('passes the turn on when the active entry is removed', () => {
    const next = removeFromTurnOrder(scene([entry('a'), entry('b', true), entry('c')], 2), e => e.id === 'b');
    expect(next.initiative.map(e => e.id)).toEqual(['a', 'c']);
    expect([activeId(next), next.round]).toEqual(['c', 2]);
    expect(activeId(stepTurn({ ...next, tokens: [] }, 1))).toBe('a');
  });

  it('wraps to the top and starts a new round when the last active entry is removed', () => {
    const next = removeFromTurnOrder(scene([entry('a'), entry('b', true)], 2), e => e.id === 'b');
    expect([activeId(next), next.round]).toEqual(['a', 3]);
  });

  it('skips removed and defeated entries when passing the turn', () => {
    const order = [entry('a'), entry('b', true, 't1'), entry('c', false, 't1'), entry('d', false, 'dead'), entry('e')];
    expect(activeId(removeFromTurnOrder(scene(order, 1, [monster('dead', 0)]), e => e.tokenId === 't1'))).toBe('e');
  });

  it('keeps the current turn when another entry is removed and ends combat when empty', () => {
    const order = [entry('a', true), entry('b')];
    expect(activeId(removeFromTurnOrder(scene(order, 1), e => e.id === 'b'))).toBe('a');
    expect(removeFromTurnOrder(scene(order, 1), e => e.id === 'zzz').initiative).toBe(order);
    expect(removeFromTurnOrder(scene(order, 4), () => true)).toEqual({ initiative: [], round: undefined });
  });
});

describe('insertByValue', () => {
  it('inserts after equal values and keeps the existing manual order', () => {
    // A DM placed b above a although both rolled 15.
    const manual = [entry('b', false, null, 15), entry('a', false, null, 15), entry('c', false, null, 8)];
    expect(insertByValue(manual, entry('n', false, null, 15)).map(e => e.id)).toEqual(['b', 'a', 'n', 'c']);
    expect(insertByValue(manual, entry('n', false, null, 20)).map(e => e.id)).toEqual(['n', 'b', 'a', 'c']);
    expect(insertByValue(manual, entry('n', false, null, 1)).map(e => e.id)).toEqual(['b', 'a', 'c', 'n']);
  });
});
