import { describe, expect, it } from 'vitest';
import { advanceInitiative, removeInitiativeEntries } from './initiative';
import type { InitiativeEntry } from './types';

const entry = (id: string, active = false, tokenId: string | null = null): InitiativeEntry =>
  ({ id, name: id, value: 10, source: 'dm', sessionId: null, tokenId, active });

const activeId = (entries: InitiativeEntry[]) => entries.find(e => e.active)?.id ?? null;

describe('initiative turn order', () => {
  it('advances and wraps', () => {
    expect(activeId(advanceInitiative([entry('a'), entry('b')]))).toBe('a');
    expect(activeId(advanceInitiative([entry('a'), entry('b', true)]))).toBe('a');
  });

  it('passes the turn on when the active entry is removed', () => {
    const order = [entry('a'), entry('b', true), entry('c')];
    const next = removeInitiativeEntries(order, e => e.id === 'b');
    expect(next.map(e => e.id)).toEqual(['a', 'c']);
    expect(activeId(next)).toBe('c');
    // The following advance continues with the next creature, not the top.
    expect(activeId(advanceInitiative(next))).toBe('a');
  });

  it('wraps to the top when the last active entry is removed', () => {
    expect(activeId(removeInitiativeEntries([entry('a'), entry('b', true)], e => e.id === 'b'))).toBe('a');
  });

  it('skips other removed entries when passing the turn', () => {
    const order = [entry('a'), entry('b', true, 't1'), entry('c', false, 't1'), entry('d')];
    expect(activeId(removeInitiativeEntries(order, e => e.tokenId === 't1'))).toBe('d');
  });

  it('keeps the current turn when another entry is removed', () => {
    const order = [entry('a', true), entry('b')];
    expect(activeId(removeInitiativeEntries(order, e => e.id === 'b'))).toBe('a');
    expect(removeInitiativeEntries(order, e => e.id === 'zzz')).toBe(order);
  });
});
