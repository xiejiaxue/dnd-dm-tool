import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import Toolbar from '../components/Toolbar';
import { brushCells, coverCellsOps, findWall, fogCellsInRect, measureDistance, removeWallOps, toolForKey } from '../components/board-tools';
import type { Scene } from '../types';

type Element = ReactElement<Record<string, any>>;
function nodes(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, any>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
const TOOL_LABELS = ['选择', '框选', '测距', '放置', '画墙', '迷雾'];
const toolButtons = (tree: ReactNode) => nodes(tree).filter(n => n.type === 'button' && TOOL_LABELS.includes(n.props['aria-label']));

describe('campaign board tools', () => {
  it('offers the DM tools with shortcuts and preserves their IDs', () => {
    const onTool = vi.fn();
    const buttons = toolButtons(Toolbar({ tool: 'select', onTool, pendingLabel: '哥布林' }));
    expect(buttons.map(n => n.props['aria-label'])).toEqual(['选择', '框选', '测距', '放置', '画墙', '迷雾']);
    expect(buttons.map(n => n.props['aria-keyshortcuts'])).toEqual(['V', 'B', 'R', undefined, 'W', 'F']);
    buttons.forEach(n => n.props.onClick());
    expect(onTool.mock.calls.map(([id]) => id)).toEqual(['select', 'select-tokens', 'measure', 'add', 'wall', 'erase']);
  });
  it('keeps the fog shape when the fog button is pressed again', () => {
    const onTool = vi.fn();
    const fog = nodes(Toolbar({ tool: 'erase-area', onTool })).find(n => n.props['aria-label'] === '迷雾')!;
    expect(fog.props['aria-pressed']).toBe(true);
    fog.props.onClick();
    expect(onTool).toHaveBeenCalledWith('erase-area');
  });
  it('does not expose an inactive placement action without a picked-up token', () => {
    const props = { tool: 'select', onTool: vi.fn() };
    const placement = (label?: string) => nodes(Toolbar({ ...props, pendingLabel: label })).find(n => n.props['aria-label'] === '放置')!;
    expect(placement().props.disabled).toBe(true);
    expect(placement('哥布林').props.disabled).toBe(false);
  });
  it('gives players and spectators only select and the ruler', () => {
    for (const role of ['player', 'spectator'] as const) {
      const tree = Toolbar({ tool: 'select', onTool: vi.fn(), role, onPlayerPreview: vi.fn() });
      expect(toolButtons(tree).map(n => n.props['aria-label'])).toEqual(['选择', '测距']);
      expect(nodes(tree).some(n => n.props['aria-label'] === '玩家视角')).toBe(false);
    }
  });
  it('toggles the DM player view from the rail', () => {
    const onPlayerPreview = vi.fn();
    const toggle = nodes(Toolbar({ tool: 'select', onTool: vi.fn(), playerPreview: false, onPlayerPreview })).find(n => n.props['aria-label'] === '玩家视角')!;
    expect(toggle.props['aria-pressed']).toBe(false);
    toggle.props.onClick();
    expect(onPlayerPreview).toHaveBeenCalledWith(true);
  });
});

describe('board tool helpers', () => {
  it('maps letter shortcuts per role and keeps the fog shape', () => {
    expect(toolForKey('w', 'dm', 'select')).toBe('wall');
    expect(toolForKey('F', 'dm', 'erase-area')).toBe('erase-area');
    expect(toolForKey('f', 'dm', 'select')).toBe('erase');
    expect(toolForKey('r', 'player', 'select')).toBe('measure');
    expect(toolForKey('w', 'player', 'select')).toBeNull();
    expect(toolForKey('x', 'dm', 'select')).toBeNull();
  });
  it('measures 5e distance with diagonals as one square', () => {
    expect(measureDistance({ x: 0, y: 0 }, { x: 150, y: 0 }, 50)).toEqual({ squares: 3, feet: 15 });
    expect(measureDistance({ x: 0, y: 0 }, { x: 150, y: 100 }, 50)).toEqual({ squares: 3, feet: 15 });
    expect(measureDistance({ x: 0, y: 0 }, { x: 0, y: 0 }, 50)).toEqual({ squares: 0, feet: 0 });
  });
  it('clips the brush to the grid without wrapping rows', () => {
    expect(brushCells(4, 3, 4, 1).sort((a, b) => a - b)).toEqual([0, 1, 4, 5, 8, 9]);
    expect(brushCells(4, 3, 5, 0)).toEqual([5]);
    expect(brushCells(4, 3, -1, 2)).toEqual([]);
  });
  it('covers every cell a rectangle touches, in room-sized messages', () => {
    const scene = { mapImage: null, mapSize: [500, 400], mapScale: 1, playArea: { x: 0, y: 0, w: 500, h: 400 } } as unknown as Scene;
    expect(fogCellsInRect(scene, { x: 60, y: 10, width: 50, height: 50 })).toEqual([1, 2, 11, 12]);
    const ops = coverCellsOps(Array.from({ length: 4500 }, (_, i) => i), 1);
    expect(ops).toHaveLength(1);
    expect(ops[0].map(op => op.op === 'setFog' && op.cells.length)).toEqual([2000, 2000, 500]);
    expect(removeWallOps(Array.from({ length: 45 }, (_, i) => ({ id: `w${i}` }))).map(batch => batch.length)).toEqual([20, 20, 5]);
  });
  it('finds a drawn wall again by its endpoints, since the room assigns wall ids', () => {
    const walls = [{ id: 'a', p1: [0, 0], p2: [100, 0] }, { id: 'b', p1: [100, 0], p2: [0, 0] }] as Scene['walls'];
    expect(findWall(walls, { p1: [0, 0], p2: [100, 0] })?.id).toBe('b');
    expect(findWall(walls, { p1: [0, 0], p2: [50, 0] })).toBeUndefined();
  });
});
