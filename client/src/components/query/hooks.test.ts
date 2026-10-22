import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Campaign, Scene } from '../../types';
import { ApiError, api } from '../../api';
import { useCompendiumSearch } from './useCompendiumSearch';
import { useFavoriteNames } from './useFavoriteNames';
import { useSceneDirectory } from './useSceneDirectory';

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type Runner = { slots: Slot[]; cursor: number; effects: Array<() => void> };
const runtime = vi.hoisted(() => ({ current: null as Runner | null }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState(initial: unknown) {
    const runner = runtime.current!;
    const index = runner.cursor++;
    const slot = runner.slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
    return [slot.value, (update: unknown) => {
      slot.value = typeof update === 'function' ? update(slot.value) : update;
    }];
  },
  useRef(initial: unknown) {
    const runner = runtime.current!;
    return (runner.slots[runner.cursor++] ??= { value: { current: initial } }).value;
  },
  useEffect(callback: () => void | (() => void), deps: unknown[]) {
    const runner = runtime.current!;
    const slot = runner.slots[runner.cursor++] ??= {};
    if (!slot.deps || deps.some((dep, index) => !Object.is(dep, slot.deps![index]))) {
      runner.effects.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = callback() || undefined; });
    }
  },
}));
vi.mock('../../api', () => ({
  ApiError: class ApiError extends Error { constructor(message: string, public status: number) { super(message); } },
  api: { search: vi.fn(), searchOnline: vi.fn(), entry: vi.fn(), scenes: vi.fn(), scene: vi.fn() },
}));
function mount<T>(hook: () => T) {
  const runner: Runner = { slots: [], cursor: 0, effects: [] };
  return {
    render() {
      runner.cursor = 0;
      runtime.current = runner;
      let result: T;
      try { result = hook(); } finally { runtime.current = null; }
      for (const effect of runner.effects.splice(0)) effect();
      return result;
    },
    unmount() { for (const slot of runner.slots) slot.cleanup?.(); },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); });

describe('useCompendiumSearch', () => {
  it('debounces for 250 ms and cancels superseded input', async () => {
    vi.mocked(api.search).mockResolvedValue([{ id: 'local' }] as never);
    const hook = mount(useCompendiumSearch);
    hook.render().setQ('gob'); hook.render();
    await vi.advanceTimersByTimeAsync(249); expect(api.search).not.toHaveBeenCalled();
    hook.render().setQ('goblin'); hook.render();
    await vi.advanceTimersByTimeAsync(250);
    expect(api.search).toHaveBeenCalledExactlyOnceWith('goblin', 'all');
    expect(api.searchOnline).not.toHaveBeenCalled();
    expect(hook.render().resultSource).toBe('local');
  });
  it('falls back online only when local search misses, including the selected type', async () => {
    vi.mocked(api.search).mockResolvedValue([]);
    vi.mocked(api.searchOnline).mockResolvedValue([{ id: 'online' }] as never);
    const hook = mount(useCompendiumSearch);
    const state = hook.render(); state.setQ('shield'); state.setType('spell'); hook.render();
    await vi.advanceTimersByTimeAsync(250);
    expect(api.searchOnline).toHaveBeenCalledExactlyOnceWith('shield', 'spell');
    expect(hook.render()).toMatchObject({ results: [{ id: 'online' }], resultSource: 'online' });
  });
  it('preserves unavailable status when local search fails instead of adding a new fallback', async () => {
    vi.mocked(api.search).mockRejectedValue(new Error('offline'));
    const hook = mount(useCompendiumSearch); hook.render().setQ('monster'); hook.render();
    await vi.advanceTimersByTimeAsync(250);
    expect(hook.render()).toMatchObject({ results: [], resultSource: 'unavailable' });
    expect(api.searchOnline).not.toHaveBeenCalled();
  });
  it('discards a stale response and clears results for whitespace input', async () => {
    const old = deferred<never>(); vi.mocked(api.search).mockReturnValueOnce(old.promise).mockResolvedValue([]);
    vi.mocked(api.searchOnline).mockResolvedValue([]);
    const hook = mount(useCompendiumSearch); hook.render().setQ('old'); hook.render();
    await vi.advanceTimersByTimeAsync(250);
    hook.render().setQ('new'); hook.render(); old.resolve([{ id: 'old' }] as never); await settle();
    expect(hook.render().results).toEqual([]); expect(api.searchOnline).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    hook.render().setQ('   '); hook.render(); await vi.advanceTimersByTimeAsync(250);
    expect(hook.render()).toMatchObject({ results: [], resultSource: null });
  });
});

describe('useFavoriteNames', () => {
  it('caches a 404 from a cleaned-up effect, skips 60 seconds of state updates and permits one retry', async () => {
    let favorites: Scene['favorites'] = [{ type: 'spell', entryId: 'missing' }];
    const pending = deferred<never>(); vi.mocked(api.entry).mockReturnValueOnce(pending.promise).mockRejectedValue(new ApiError('missing', 404));
    const hook = mount(() => useFavoriteNames(favorites)); hook.render();
    favorites = [...favorites]; hook.render(); expect(api.entry).toHaveBeenCalledTimes(1);
    pending.reject(new ApiError('missing', 404)); await settle();
    for (const time of [1, 1000, 30000, 59999]) { vi.setSystemTime(time); favorites = [...favorites]; hook.render(); }
    expect(api.entry).toHaveBeenCalledTimes(1);
    vi.setSystemTime(60000); favorites = [...favorites]; hook.render();
    favorites = [...favorites]; hook.render(); expect(api.entry).toHaveBeenCalledTimes(2); await settle();
    vi.setSystemTime(119999); favorites = [...favorites]; hook.render(); expect(api.entry).toHaveBeenCalledTimes(2);
    vi.setSystemTime(120000); favorites = [...favorites]; hook.render(); expect(api.entry).toHaveBeenCalledTimes(3);
    await settle();
  });
  it('keeps successful names and ID fallback cached', async () => {
    const favorites: Scene['favorites'] = [{ type: 'spell', entryId: 'known' }, { type: 'item', entryId: 'unnamed' }];
    vi.mocked(api.entry).mockResolvedValueOnce({ name: '护盾术' }).mockResolvedValueOnce({});
    const hook = mount(() => useFavoriteNames(favorites)); hook.render(); await settle();
    expect(hook.render()).toEqual({ known: '护盾术', unnamed: 'unnamed' });
    expect(api.entry).toHaveBeenCalledTimes(2);
  });
  it('does not negative-cache non-404 failures or duplicate concurrent entry IDs', async () => {
    let favorites: Scene['favorites'] = [{ type: 'spell', entryId: 'retry' }, { type: 'spell', entryId: 'retry' }];
    vi.mocked(api.entry).mockRejectedValue(new ApiError('unavailable', 503));
    const hook = mount(() => useFavoriteNames(favorites)); hook.render(); expect(api.entry).toHaveBeenCalledTimes(1); await settle();
    favorites = [...favorites]; hook.render(); expect(api.entry).toHaveBeenCalledTimes(2); await settle();
  });
});

describe('useSceneDirectory', () => {
  it('resolves names, exposes only unlocked previews and refreshes on scene-list identity changes', async () => {
    let ids: Campaign['sceneIds'] = ['locked', 'open'];
    vi.mocked(api.scenes).mockResolvedValue([{ id: 'locked', name: '密室', unlocked: false }, { id: 'open', name: '营地', unlocked: true }]);
    const hook = mount(() => useSceneDirectory(ids)); hook.render(); await settle();
    expect(hook.render()).toMatchObject({ sceneNames: { open: { name: '营地', unlocked: true } }, unlockedScenes: ['open'] });
    expect(api.scenes).toHaveBeenCalledTimes(1); ids = [...ids]; hook.render(); expect(api.scenes).toHaveBeenCalledTimes(2); await settle();
  });
  it('opens and closes a read-only preview without changing the selected scene', async () => {
    vi.mocked(api.scenes).mockResolvedValue([]);
    const preview = { id: 'open', name: '营地', tokens: [], players: [] } as unknown as Scene;
    vi.mocked(api.scene).mockResolvedValue(preview);
    const hook = mount(() => useSceneDirectory(['open'])); const state = hook.render(); await state.openPreview('open');
    expect(hook.render().preview).toBe(preview); hook.render().closePreview(); expect(hook.render().preview).toBeNull();
  });
});
