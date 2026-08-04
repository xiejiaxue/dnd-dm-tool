import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SceneStore, SceneNotFoundError } from './store';

let dir: string;
let store: SceneStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenes-'));
  store = new SceneStore(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SceneStore', () => {
  it('creates and lists scenes', async () => {
    const a = await store.create('地牢');
    const b = await store.create('森林');
    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list.map(x => x.name)).toEqual(expect.arrayContaining(['地牢', '森林']));
    expect(a.name).toBe('地牢');
    expect(b.id).not.toBe(a.id);
  });

  it('round-trips save/get', async () => {
    const s = await store.create('测试');
    s.tokens.push({ id: 't1', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 1, y: 2, size: 100, avatar: '', color: '#fff' });
    store.save(s);
    const got = await store.get(s.id);
    expect(got.tokens).toHaveLength(1);
    expect(got.tokens[0].x).toBe(1);
    expect(got.name).toBe('测试');
  });

  it('get missing throws', async () => {
    await expect(store.get('nope')).rejects.toBeInstanceOf(SceneNotFoundError);
  });

  it('delete removes file', async () => {
    const s = await store.create('删');
    await store.delete(s.id);
    await expect(store.get(s.id)).rejects.toBeInstanceOf(SceneNotFoundError);
  });

  it('last-scene id is remembered', async () => {
    const s = await store.create('a');
    store.setLast(s.id);
    expect(await store.last()).toBe(s.id);
    store.setLast(null);
    expect(await store.last()).toBeNull();
  });
});
