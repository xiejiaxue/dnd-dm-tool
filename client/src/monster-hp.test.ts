import { describe, it, expect, vi } from 'vitest';
import { createMonsterHpLoader, fillMissingMonsterHp, monsterHp } from './monster-hp';
import type { Scene, Token } from './types';
const token = (id: string, hp?: Token['hp']) => ({ id, entryId: 'MM__Goblin', kind: 'monster', hp } as Token);
const scene = (tokens: Token[], id = 'a') => ({ id, tokens } as Scene);

describe('monster HP initialization', () => {
  it('uses the published average without interpreting special or invalid HP', () => {
    expect(monsterHp({ hp: { average: 7, formula: '2d6' } })).toEqual({ current: 7, max: 7 });
    for (const hp of [undefined, { special: 'Varies' }, { average: -1 }, { average: NaN }, { average: '7' }]) expect(monsterHp({ hp })).toBeUndefined();
  });
  it('deduplicates lookups and permits retry after a transient failure', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ hp: { average: 7 } });
      const load = createMonsterHpLoader(fetch);
      await Promise.all([load('MM__Goblin'), load('MM__Goblin')]);
      expect(fetch).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(60_001);
      expect(await load('MM__Goblin')).toEqual({ current: 7, max: 7 });
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it('repairs old and newly placed tokens without changing wounded or zero HP', async () => {
    const current = scene([token('new'), token('old'), token('wounded', { current: 3, max: 7 }), token('dead', { current: 0, max: 7 })]);
    const send = vi.fn(); const load = vi.fn().mockResolvedValue({ current: 7, max: 7 });
    await fillMissingMonsterHp(current, () => current, send, load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(['new', 'old'].map(tokenId => ({ op: 'updateToken', tokenId, patch: { hp: { current: 7, max: 7 } } })));
  });
  it('does not overwrite edits made during a lookup or update a departed scene', async () => {
    for (const move of [false, true]) {
      let resolve!: (v: { current: number; max: number }) => void;
      const deferred = new Promise<{ current: number; max: number }>(r => { resolve = r; });
      let live = scene([token('one')]); const send = vi.fn();
      const work = fillMissingMonsterHp(live, () => live, send, () => deferred);
      live = move ? scene([token('one')], 'b') : scene([token('one', { current: 2, max: 10 })]);
      resolve({ current: 7, max: 7 }); await work;
      expect(send).not.toHaveBeenCalled();
    }
  });
});
