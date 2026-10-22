import { describe, expect, it } from 'vitest';
import { mergedSelection, selectedAfterClick, tokensInsideRect } from '../features/board/selection';
import type { Token } from '../types';

const tokens: Token[] = [
  { id: 'a', kind: 'monster', name: 'A', entryId: null, x: 50, y: 50, size: 40, avatar: '', color: '#fff' },
  { id: 'b', kind: 'npc', name: 'B', entryId: null, x: 150, y: 50, size: 40, avatar: '', color: '#fff' },
  { id: 'c', kind: 'monster', name: 'C', entryId: null, x: 300, y: 300, size: 40, avatar: '', color: '#fff' },
];

describe('board multi-selection', () => {
  it('selects intersecting token footprints with a marquee', () => {
    expect(tokensInsideRect(tokens, { x: 20, y: 20, w: 150, h: 60 })).toEqual(['a', 'b']);
  });

  it('replaces, adds, and toggles deterministic selections', () => {
    expect(selectedAfterClick(['a'], 'b', false)).toEqual(['b']);
    expect(selectedAfterClick(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(selectedAfterClick(['a', 'b'], 'a', true)).toEqual(['b']);
    expect(mergedSelection(['a'], ['b', 'c'], true)).toEqual(['a', 'b', 'c']);
    expect(mergedSelection(['a'], ['b'], false)).toEqual(['b']);
  });
});

