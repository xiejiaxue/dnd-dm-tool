import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, useLayoutEffect, type ReactElement, type ReactNode } from 'react';
import type { Scene } from '../types';

const state = vi.hoisted(() => ({ scene: null as Scene | null, role: 'dm', measured: true, sendOps: vi.fn(), setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => { const setter = vi.fn(); state.setters.push(setter); const initial = typeof value === 'function' ? value() : value; const measured = initial && typeof initial === 'object' && 'width' in initial && 'height' in initial && state.measured ? { width: 800, height: 600 } : initial; return [measured, setter]; },
  useEffect: vi.fn(), useLayoutEffect: vi.fn(),
  useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn,
}));
vi.mock('react-konva', () => Object.fromEntries(['Stage', 'Layer', 'Rect', 'Shape', 'Line', 'Image', 'Group', 'Circle', 'Text', 'Ring', 'Label', 'Tag'].map(name => [name, name])));
vi.mock('konva', () => ({ default: {} }));
vi.mock('../ws', () => ({ useScene: () => state, getMySessionId: () => 'me', connection: { sendOps: state.sendOps } }));
vi.mock('../useImage', () => ({ useImage: () => null }));
vi.mock('../hooks/useMapScale', () => ({ useMapScale: () => ({ value: 1 }) }));
import BoardCanvas from '../components/BoardCanvas';
import TokenShape from '../components/TokenShape';

type Element = ReactElement<Record<string, any>>;
function nodes(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, any>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
function renderBoard(tool = 'select') {
  return nodes(BoardCanvas({ tool, pending: null, onClearPending: vi.fn(), selectedId: null, onSelect: vi.fn(), queryOpen: true, brushSize: 0 }));
}
afterEach(() => { vi.useRealTimers();vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.clearAllMocks();state.setters = [];state.role = 'dm';state.measured = true;
  const base = { name: 'token', entryId: null, x: 100, y: 100, size: 48, avatar: '', color: '#ba3526' };
  state.scene = { id: 's', name: 's', mapImage: null, mapSize: [500, 400], mapScale: 1, grid: { size: 100, color: '#fff', offset: [0, 0], snap: true }, playArea: { x: 0, y: 0, w: 500, h: 400 }, walls: [], initiative: [], favorites: [], tokens: [{ ...base, id: 'enemy', kind: 'monster' }], players: [{ ...base, id: 'own', kind: 'player', sessionId: 'me' }, { ...base, id: 'other', kind: 'player', sessionId: 'other' }] };
});

describe('board layering and movement', () => {
  it('waits for nonzero canvas dimensions before drawing saved tokens', () => {
    state.measured = false;
    state.scene!.tokens[0].hidden = true;
    expect(renderBoard().some(n => n.type === 'Stage')).toBe(false);
    state.measured = true;
    expect(renderBoard().some(n => n.type === 'Stage')).toBe(true);
  });
  it.each(['dm', 'player'])('keeps player pieces above fog and enemies for %s', role => {
    state.role = role;
    const layers = renderBoard().filter(n => n.type === 'Layer');
    expect(layers).toHaveLength(2);
    expect(nodes(layers[0]).some(n => n.props.name === 'fog-mask')).toBe(true);
    expect(nodes(layers[0]).filter(n => n.type === TokenShape).map(n => n.props.token.id)).toEqual(['enemy']);
    expect(nodes(layers[1]).filter(n => n.type === TokenShape).map(n => n.props.token.id)).toEqual(['own', 'other']);
  });
  it('preserves ownership and tool drag permissions on the upper layer', () => {
    state.role = 'player';
    expect(renderBoard().filter(n => n.type === TokenShape).map(n => n.props.draggable)).toEqual([false, true, false]);
    state.role = 'dm';
    for (const tool of ['wall', 'erase', 'erase-area', 'add', 'select-tokens']) {
      expect(renderBoard(tool).filter(n => n.type === TokenShape).every(n => !n.props.draggable)).toBe(true);
    }
  });
  it('handles touch fog strokes and ignores further movement after cancellation', () => {
    vi.useFakeTimers();vi.stubGlobal('window', { setTimeout });
    const stage = renderBoard('erase').find(n => n.type === 'Stage')!;
    let point = { x: 125, y: 125 };
    (stage as Element & { ref: { current: unknown } }).ref.current = { getRelativePointerPosition: () => point };
    const touch = { evt: { touches: [{}] }, target: (stage as Element & { ref: { current: unknown } }).ref.current };
    stage.props.onTouchStart(touch);
    point = { x: 175, y: 125 };stage.props.onTouchMove(touch);
    vi.advanceTimersByTime(120);
    expect(state.sendOps).toHaveBeenCalledWith([{ op: 'setFog', cells: [22, 23], revealed: true, basisScale: 1 }]);
    state.sendOps.mockClear();
    stage.props.onTouchStart(touch);stage.props.onTouchCancel();
    stage.props.onTouchMove(touch);vi.advanceTimersByTime(120);
    expect(state.sendOps).not.toHaveBeenCalled();
  });
  it('reveals a rectangle only on release, and cancels a pending selection', () => {
    const stage = renderBoard('erase-area').find(n => n.type === 'Stage')!;
    let point = { x: 50, y: 50 };
    (stage as Element & { ref: { current: unknown } }).ref.current = { getRelativePointerPosition: () => point };
    const touch = { evt: { touches: [{}] }, target: (stage as Element & { ref: { current: unknown } }).ref.current };
    stage.props.onTouchStart(touch);
    point={x:150,y:150};stage.props.onTouchMove(touch);
    expect(state.sendOps).not.toHaveBeenCalled();
    stage.props.onTouchEnd();
    expect(state.sendOps).toHaveBeenCalledWith([{op:'revealFogRect',rect:{x:50,y:50,width:100,height:100}}]);
    stage.props.onTouchEnd();expect(state.sendOps).toHaveBeenCalledTimes(1);
    state.sendOps.mockClear();stage.props.onTouchStart(touch);
    point={x:250,y:250};stage.props.onTouchMove(touch);stage.props.onTouchCancel();stage.props.onTouchEnd();
    expect(state.sendOps).not.toHaveBeenCalled();
  });
  it('sends a large exact selection as one compact operation', () => {
    state.scene!.playArea={x:0,y:0,w:5000,h:5000};
    const stage=renderBoard('erase-area').find(n=>n.type==='Stage')!;
    let point={x:0,y:0};
    (stage as Element & {ref:{current:unknown}}).ref.current={getRelativePointerPosition:()=>point};
    stage.props.onTouchStart({evt:{touches:[{}]}});
    point={x:5000,y:5000};stage.props.onTouchEnd();
    const batches=state.sendOps.mock.calls.flatMap(call=>call[0]);
    expect(batches).toEqual([{op:'revealFogRect',rect:{x:0,y:0,width:5000,height:5000}}]);
  });
  it('does not let players reveal a selected area', () => {
    state.role='player';
    const stage = renderBoard('erase-area').find(n => n.type === 'Stage')!;
    (stage as Element & { ref: { current: unknown } }).ref.current = { getRelativePointerPosition: () => ({x:100,y:100}) };
    stage.props.onTouchStart({evt:{touches:[{}]}});stage.props.onTouchEnd();
    expect(state.sendOps).not.toHaveBeenCalled();
  });
  it('ends a touch wall once, and cancels multi-touch or scene-boundary strokes', () => {
    const stage = renderBoard('wall').find(n => n.type === 'Stage')!;
    let point = { x: 100, y: 100 };
    (stage as Element & { ref: { current: unknown } }).ref.current = { getRelativePointerPosition: () => point };
    const touch = { evt: { touches: [{}] }, target: (stage as Element & { ref: { current: unknown } }).ref.current };
    stage.props.onTouchStart(touch);point = { x: 300, y: 100 };stage.props.onTouchMove(touch);
    stage.props.onTouchEnd();stage.props.onTouchEnd();
    expect(state.sendOps).toHaveBeenCalledTimes(1);
    expect(state.sendOps.mock.calls[0][0][0].wall).toMatchObject({ p1: [100, 100], p2: [300, 100] });
    state.sendOps.mockClear();
    stage.props.onTouchStart(touch);point = { x: 500, y: 100 };stage.props.onTouchMove(touch);
    stage.props.onTouchStart({ ...touch, evt: { touches: [{}, {}] } });stage.props.onTouchEnd();
    expect(state.sendOps).not.toHaveBeenCalled();
    stage.props.onTouchStart(touch);point = { x: 600, y: 100 };stage.props.onTouchMove(touch);
    for (const [reset, deps] of vi.mocked(useLayoutEffect).mock.calls) { if (deps?.includes('wall')) reset(); }
    stage.props.onTouchEnd();
    expect(state.sendOps).not.toHaveBeenCalled();
  });
  it('restores controlled canvas coordinates even when grid snapping produces no state change', () => {
    const element = renderBoard().find(n => n.type === TokenShape && n.props.token.id === 'enemy')!;
    const tokenTree = TokenShape.type(element.props as Parameters<typeof TokenShape.type>[0]);
    const group = nodes(tokenTree)[0];
    let position = { x: 120, y: 115 };
    const target = { position: (next?: typeof position) => next ? (position = next) : position };
    group.props.onDragEnd({ target });
    expect(position).toEqual({ x: 100, y: 100 });
    expect(state.sendOps).toHaveBeenCalledWith([{ op: 'moveToken', tokenId: 'enemy', x: 100, y: 100 }]);
    position = { x: 175, y: 230 };
    group.props.onDragEnd({ target });
    expect(state.sendOps).toHaveBeenLastCalledWith([{ op: 'moveToken', tokenId: 'enemy', x: 200, y: 200 }]);
  });
});


describe('enemy selection gestures', () => {
  it.each(['dm', 'player'])('only the DM can marquee-select enemies (%s)', role => {
    state.role = role;
    const tree = renderBoard('select-tokens');
    const stage = tree.find(n => n.type === 'Stage')!;
    let point = {x:50,y:50};
    (stage as Element & {ref:{current:unknown}}).ref.current = {getRelativePointerPosition:() => point};
    expect(stage.props.draggable).toBe(false);
    stage.props.onMouseDown({evt:{button:0}});
    point = {x:150,y:150}; stage.props.onMouseMove({evt:{button:0}});
    stage.props.onMouseUp();
    const selections = state.setters.flatMap(setter => setter.mock.calls).filter(call => Array.isArray(call[0]) && call[0].length);
    expect(selections).toEqual(role === 'dm' ? [[['enemy']]] : []);
    expect(state.sendOps).not.toHaveBeenCalled();
    expect(tree.some(n => n.props['aria-label'] === '批量Token可见性')).toBe(role === 'dm');
  });
  it('cancels a touch selection without selecting or changing tokens', () => {
    const stage = renderBoard('select-tokens').find(n => n.type === 'Stage')!;
    let point = {x:50,y:50};
    (stage as Element & {ref:{current:unknown}}).ref.current = {getRelativePointerPosition:() => point};
    stage.props.onTouchStart({evt:{touches:[{}]}});
    point = {x:150,y:150};stage.props.onTouchMove({evt:{touches:[{}]}});
    stage.props.onTouchCancel();stage.props.onTouchEnd();
    expect(state.setters.flatMap(setter => setter.mock.calls).filter(call => Array.isArray(call[0]) && call[0].length)).toEqual([]);
    expect(state.sendOps).not.toHaveBeenCalled();
  });
});
