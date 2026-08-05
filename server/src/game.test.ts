import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GameServer } from './game';
import { SceneStore } from './store';
import { CampaignStore } from './campaign-store';

let game: GameServer;
let store: SceneStore;
let campaignStore: CampaignStore;
let dir: string;

// Fake ws client for driving the private `handle` directly (no sockets needed).
function fakeClient(role: 'dm' | 'player'): any {
  return { ws: { send: () => {}, readyState: 1, OPEN: 1 }, role, name: role };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-'));
  store = new SceneStore(path.join(dir, 'scenes'));
  campaignStore = new CampaignStore(path.join(dir, 'campaigns'));
  game = new GameServer(store, campaignStore, { password: 'pw' });
  await game.init();
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('GameServer.roleFor', () => {
  it('treats localhost addresses as dm', () => {
    expect(game.roleFor('127.0.0.1')).toBe('dm');
    expect(game.roleFor('::1')).toBe('dm');
    expect(game.roleFor('::ffff:127.0.0.1')).toBe('dm');
  });

  it('treats remote addresses as player', () => {
    expect(game.roleFor('192.168.1.50')).toBe('player');
  });

  it('upgrades a player to dm with a valid dmToken', () => {
    expect(game.roleFor('192.168.1.50', 'pw')).toBe('dm');
  });

  it('rejects a wrong dmToken', () => {
    expect(game.roleFor('192.168.1.50', 'wrong')).toBe('player');
  });

  it('gives localhost priority over a wrong dmToken', () => {
    expect(game.roleFor('127.0.0.1', 'wrong')).toBe('dm');
  });
});

describe('GameServer 战役集成', () => {
  it('init 无战役时自动建「默认战役」收录全部场景', () => {
    expect(game.currentCampaign).toBeTruthy();
    expect(game.currentCampaign.name).toBe('默认战役');
    expect(game.currentCampaign.sceneIds).toContain(game.current.id);
  });

  it('op 分流：addEnemy 写入战役、addToken 写入场景，且各自持久化', async () => {
    (game as any).handle(fakeClient('dm'), {
      type: 'op',
      ops: [
        { op: 'addEnemy', entryId: 'MM__Goblin', nameZh: '地精' },
        { op: 'addToken', token: { id: 't1', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 0, y: 0, size: 100, avatar: '/api/token/MM__Goblin', color: '#fff' } },
      ],
    });
    expect(game.currentCampaign.enemies.some(e => e.entryId === 'MM__Goblin')).toBe(true);
    expect(game.current.tokens.some(t => t.id === 't1')).toBe(true);
    const persistedCampaign = await campaignStore.get(game.currentCampaign.id);
    expect(persistedCampaign.enemies.some(e => e.entryId === 'MM__Goblin')).toBe(true);
    const persistedScene = await store.get(game.current.id);
    expect(persistedScene.tokens.some(t => t.id === 't1')).toBe(true);
  });

  it('switchCampaign 载入新战役，当前场景不属于该战役则切换其首场景', async () => {
    const c = await campaignStore.create('新战役');
    const scene = await store.create('新场景');
    await campaignStore.assignScene(c.id, scene.id);
    await (game as any).switchCampaign(c.id);
    expect(game.currentCampaign.id).toBe(c.id);
    expect(game.current.id).toBe(scene.id);
  });

  it('switchCampaign 空战役新建「未命名场景」并收录', async () => {
    const c = await campaignStore.create('空战役');
    await (game as any).switchCampaign(c.id);
    expect(game.currentCampaign.id).toBe(c.id);
    expect(game.current.name).toBe('未命名场景');
    const updated = await campaignStore.get(c.id);
    expect(updated.sceneIds).toContain(game.current.id);
  });
});
