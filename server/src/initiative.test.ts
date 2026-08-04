import { describe, it, expect } from 'vitest';
import { sortInitiative, advanceInitiative, activeEntry } from './initiative';
import { InitiativeEntry } from './types';

function e(id: string, value: number, active = false): InitiativeEntry {
  return { id, name: id, value, source: 'dm', sessionId: null, tokenId: null, active };
}

describe('sortInitiative', () => {
  it('sorts by value desc, stable for ties', () => {
    const sorted = sortInitiative([e('a', 10), e('b', 20), e('c', 15), e('d', 20)]);
    expect(sorted.map(x => x.id)).toEqual(['b', 'd', 'c', 'a']);
  });
});

describe('advanceInitiative', () => {
  it('activates first when none active', () => {
    const list = [e('a', 10), e('b', 20)];
    const out = advanceInitiative(list);
    expect(out.find(x => x.active)!.id).toBe('a');
  });

  it('moves to next and wraps around', () => {
    let list = [e('a', 10, true), e('b', 20), e('c', 30)];
    list = advanceInitiative(list);
    expect(list.find(x => x.active)!.id).toBe('b');
    list = advanceInitiative(list);
    expect(list.find(x => x.active)!.id).toBe('c');
    list = advanceInitiative(list);
    expect(list.find(x => x.active)!.id).toBe('a');
  });

  it('empty list is safe', () => {
    expect(advanceInitiative([])).toEqual([]);
  });
});

describe('activeEntry', () => {
  it('returns active or null', () => {
    expect(activeEntry([e('a', 1, true)])!.id).toBe('a');
    expect(activeEntry([e('a', 1)])).toBeNull();
  });
});
