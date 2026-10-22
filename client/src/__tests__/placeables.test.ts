import { describe, expect, it } from 'vitest';
import { mergePlaceables, notesInsideRect, selectPlaceable, wallsInsideRect } from '../features/board/placeables';

describe('unified placeable selection', () => {
  it('selects across kinds without id collisions', () => {
    const selected = selectPlaceable([{ kind: 'token', id: 'same' }], { kind: 'wall', id: 'same' }, true);
    expect(selected).toEqual([{ kind: 'token', id: 'same' }, { kind: 'wall', id: 'same' }]);
    expect(mergePlaceables(selected, [{ kind: 'note', id: 'n1' }], true)).toHaveLength(3);
  });

  it('finds walls and notes inside a marquee', () => {
    const rect = { x: 0, y: 0, w: 100, h: 100 };
    expect(wallsInsideRect([{ id: 'w1', p1: [-10, 50], p2: [10, 50] }], rect)).toEqual([{ kind: 'wall', id: 'w1' }]);
    expect(notesInsideRect([{
      id: 'n1', sceneId: 's1', journalId: 'j1', pageId: null, x: 50, y: 60,
      label: 'Note', icon: 'pin', visibility: 'gm', flags: {},
    }], rect)).toEqual([{ kind: 'note', id: 'n1' }]);
  });
});
