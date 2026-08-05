import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CampaignStore, CampaignNotFoundError } from './campaign-store';

let dir: string;
let store: CampaignStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaigns-'));
  store = new CampaignStore(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('CampaignStore', () => {
  it('creates and lists campaigns', async () => {
    const a = await store.create('地牢冒险');
    const b = await store.create('沙漠远征');
    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list.map(x => x.name)).toEqual(expect.arrayContaining(['地牢冒险', '沙漠远征']));
    expect(a.id).not.toBe(b.id);
  });

  it('round-trips save/get', async () => {
    const c = await store.create('测试战役');
    c.enemies.push({ entryId: 'MM__Goblin', nameZh: '地精' });
    store.save(c);
    const got = await store.get(c.id);
    expect(got.enemies).toHaveLength(1);
    expect(got.enemies[0].nameZh).toBe('地精');
  });

  it('get missing throws', async () => {
    await expect(store.get('nope')).rejects.toBeInstanceOf(CampaignNotFoundError);
  });

  it('delete removes file', async () => {
    const c = await store.create('删');
    await store.delete(c.id);
    await expect(store.get(c.id)).rejects.toBeInstanceOf(CampaignNotFoundError);
  });

  it('assignScene moves a scene across campaigns', async () => {
    const a = await store.create('A');
    const b = await store.create('B');
    await store.assignScene(a.id, 'scene-x');
    await store.assignScene(b.id, 'scene-x');
    expect((await store.get(a.id)).sceneIds).toEqual([]);
    expect((await store.get(b.id)).sceneIds).toEqual(['scene-x']);
  });
});
