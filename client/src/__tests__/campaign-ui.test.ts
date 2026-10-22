import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import Toolbar from '../components/Toolbar';

type Element = ReactElement<Record<string, any>>;
function nodes(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, any>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}

describe('campaign board tools', () => {
  it('offers only functional DM modes and preserves their IDs', () => {
    const onTool = vi.fn();
    const tree = Toolbar({ tool: 'select', onTool, pendingLabel: '哥布林' });
    const buttons = nodes(tree).filter(n => n.type === 'button');
    expect(buttons.map(n => n.props['aria-label'])).toEqual(['选择', '框选', '放置', '画墙', '擦除']);
    buttons.forEach(n => n.props.onClick());
    expect(onTool.mock.calls.map(([id]) => id)).toEqual(['select', 'select-tokens', 'add', 'wall', 'erase']);
  });
  it('does not expose an inactive placement action without a picked-up token', () => {
    const props = { tool: 'select', onTool: vi.fn() };
    const placement = (label?: string) => nodes(Toolbar({ ...props, pendingLabel: label })).find(n => n.props['aria-label'] === '放置')!;
    expect(placement().props.disabled).toBe(true);
    expect(placement('哥布林').props.disabled).toBe(false);
  });
  it('leaves players and spectators direct board interaction without redundant mode buttons', () => {
    const props = { tool: 'select', onTool: vi.fn() };
    expect(Toolbar({ ...props, role: 'player' })).toBeNull();
    expect(Toolbar({ ...props, role: 'spectator' })).toBeNull();
  });
  it('shows the eraser range only for the active mode and retains the three range values', () => {
    const onBrushSize = vi.fn();
    const tree = Toolbar({ tool: 'erase', onTool: vi.fn(), brushSize: 1, onBrushSize });
    const group = nodes(tree).find(n => n.props['aria-label'] === '擦除范围')!;
    const buttons = nodes(group.props.children).filter(n => n.type === 'button');
    expect(buttons.map(n => n.props['aria-pressed'])).toEqual([false, true, false]);
    buttons.forEach(n => n.props.onClick());
    expect(onBrushSize.mock.calls).toEqual([[0], [1], [2]]);
  });
});
