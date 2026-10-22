import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
const state = vi.hoisted(() => ({ role: 'player', fields: ['', '', ''], index: 0, sendOps: vi.fn() }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [state.index < state.fields.length ? state.fields[state.index++] : initial, vi.fn()],
  useRef: () => ({ current: null }), useEffect: vi.fn(),
}));
vi.mock('../ws', () => ({
  useScene: () => ({ role: state.role, scene: { id: 'scene', initiative: [], tokens: [{ id: 'enemy', name: '哥布林' }], players: [{ id: 'own', name: '莱拉', sessionId: 'me' }] } }),
  getMySessionId: () => 'me', connection: { sendOps: state.sendOps },
}));
import InitiativePanel, { parseInitiativeValue } from '../components/InitiativePanel';
type Element = ReactElement<Record<string, any>>;
function nodes(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, any>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
beforeEach(() => {state.index = 0;state.fields = ['', '', ''];state.role = 'player';vi.clearAllMocks();});
describe('initiative input validation', () => {
  it('rejects empty, whitespace, nonnumeric and out-of-range input', () => {
    for (const input of ['', '  ', 'abc', 'NaN', 'Infinity', '-101', '101']) expect(parseInitiativeValue(input)).toBeNull();
  });
  it('accepts explicit zero, negatives and the existing protocol bounds', () => {
    for (const input of ['0', '-3', ' 18 ', '-100', '100', '1.5']) expect(parseInitiativeValue(input)).toBe(Number(input));
  });
  it('blocks empty submissions for both clicks and Enter', () => {
    const tree = nodes(InitiativePanel({}));
    const button = tree.find(n => n.type === 'button' && n.props.children === '提交')!;
    expect(button.props.disabled).toBe(true);button.props.onClick();
    tree.find(n => n.props['aria-label'] === '我的先攻值')!.props.onKeyDown({ key: 'Enter' });
    expect(state.sendOps).not.toHaveBeenCalled();
  });
  it('submits an explicit zero linked to the player token', () => {
    state.fields[0] = '0';
    const tree = nodes(InitiativePanel({}));
    expect(tree.find(n => n.type === 'button' && n.props.children === '提交')!.props.disabled).toBe(false);
    tree.find(n => n.props['aria-label'] === '我的先攻值')!.props.onKeyDown({ key: 'Enter' });
    expect(state.sendOps).toHaveBeenCalledWith([{ op: 'submitInitiative', name: '莱拉', value: 0, tokenId: 'own', sessionId: 'me' }]);
  });
  it('validates DM values and retains selected-token linkage', () => {
    state.role = 'dm';state.fields[2] = '101';
    let tree = nodes(InitiativePanel({ selectedTokenId: 'enemy' }));
    const add = tree.find(n => n.type === 'button' && n.props.children === '加入先攻')!;
    expect(add.props.disabled).toBe(true);add.props.onClick();expect(state.sendOps).not.toHaveBeenCalled();
    state.index = 0;state.fields[2] = '18';
    tree = nodes(InitiativePanel({ selectedTokenId: 'enemy' }));
    tree.find(n => n.props['aria-label'] === '先攻值')!.props.onKeyDown({ key: 'Enter' });
    expect(state.sendOps).toHaveBeenCalledWith([{ op: 'addToInitiative', name: '哥布林', value: 18, source: 'dm', tokenId: 'enemy' }]);
  });
});
