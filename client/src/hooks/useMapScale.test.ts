import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { connection } from '../ws';
import { useMapScale } from './useMapScale';

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
const runtime = vi.hoisted(() => ({ slots: [] as Slot[], cursor: 0, effects: [] as Array<() => void> }));
vi.mock('../ws', () => ({ connection: { sendOps: vi.fn() } }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useRef: (value: unknown) => (runtime.slots[runtime.cursor++] ??= { value: { current: value } }).value,
  useState(value: unknown) {
    const slot = runtime.slots[runtime.cursor++] ??= { value };
    return [slot.value, (update: unknown) => { slot.value = typeof update === 'function' ? update(slot.value) : update; }];
  },
  useCallback(callback: unknown, deps: unknown[]) {
    const slot = runtime.slots[runtime.cursor++] ??= {};
    if (!slot.deps || deps.some((v, i) => !Object.is(v, slot.deps![i]))) {
      slot.deps = deps; slot.value = callback;
    }
    return slot.value;
  },
  useLayoutEffect(callback: () => (() => void), deps: unknown[]) {
    const slot = runtime.slots[runtime.cursor++] ??= {};
    if (!slot.deps || deps.some((v, i) => !Object.is(v, slot.deps![i]))) {
      runtime.effects.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = callback(); });
    }
  },
}));
let context: Parameters<typeof useMapScale>[0];
let frames: Map<number, FrameRequestCallback>, sequence: number;
function render() {
  runtime.cursor = 0;
  const value = useMapScale(context);
  for (const effect of runtime.effects.splice(0)) effect();
  return value;
}
function draw() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)); }
beforeEach(() => {
  runtime.slots = []; runtime.effects = []; runtime.cursor = 0;
  context = { sceneId: 's1', mapImage: '/map.png', value: 1, enabled: true };
  frames = new Map(); sequence = 0;
  vi.clearAllMocks();
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++sequence, fn); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());

describe('map-only scale draft', () => {
  it('previews at frame cadence and sends exactly one map-scale operation at release', () => {
    const hook = render();
    for (let n = 101; n <= 180; n++) hook.preview(n / 100);
    expect(frames.size).toBe(1); expect(connection.sendOps).not.toHaveBeenCalled();
    draw(); expect(render().value).toBe(1.8);
    hook.commit(); hook.commit();
    expect(connection.sendOps).toHaveBeenCalledExactlyOnceWith([{ op: 'updateMapScale', mapScale: 1.8 }]);
  });
  it('commits the latest value even if pointer-up arrives before the animation frame', () => {
    const hook = render(); hook.preview(2.33); hook.commit();
    expect(connection.sendOps).toHaveBeenCalledExactlyOnceWith([{ op: 'updateMapScale', mapScale: 2.33 }]);
    expect(frames.size).toBe(0);
  });
  it('drops a pending edit when the scene, map image, or role changes', () => {
    for (const change of [{ sceneId: 's2' }, { mapImage: '/other.png' }, { enabled: false }]) {
      context = { sceneId: 's1', mapImage: '/map.png', value: 1, enabled: true };
      const hook = render(); hook.preview(3);
      context = { ...context, ...change }; render(); hook.commit(); draw();
      expect(render().value).toBe(1); expect(connection.sendOps).not.toHaveBeenCalled();
    }
  });
  it('cancels on pointer cancellation/unmount without sending anything', () => {
    const hook = render(); hook.preview(2); hook.cancel(); draw(); expect(render().value).toBe(1);
    hook.preview(3); for (const slot of runtime.slots) slot.cleanup?.();
    hook.commit(); expect(frames.size).toBe(0); expect(connection.sendOps).not.toHaveBeenCalled();
  });
  it('clamps bounds, avoids unchanged commands and follows authoritative rollback after commit', () => {
    const hook = render(); hook.set(1); expect(connection.sendOps).not.toHaveBeenCalled();
    hook.set(99); expect(connection.sendOps).toHaveBeenLastCalledWith([{ op: 'updateMapScale', mapScale: 8 }]);
    context = { ...context, value: 8 }; expect(render().value).toBe(8);
    context = { ...context, value: 1 }; expect(render().value).toBe(1);
  });
});
