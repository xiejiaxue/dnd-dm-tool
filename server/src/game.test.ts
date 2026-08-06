import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GameServer } from './game';
import { SceneStore } from './store';
import { CampaignStore } from './campaign-store';
import { applyOp } from './ops';
import { Role } from './types';

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
    // op 应用现在经 async applyAllowedOps（重读磁盘），需等微任务落定
    await new Promise(r => setTimeout(r, 0));
    expect(game.currentCampaign.enemies.some(e => e.entryId === 'MM__Goblin')).toBe(true);
    expect(game.current.tokens.some(t => t.id === 't1')).toBe(true);
    const persistedCampaign = await campaignStore.get(game.currentCampaign.id);
    expect(persistedCampaign.enemies.some(e => e.entryId === 'MM__Goblin')).toBe(true);
    const persistedScene = await store.get(game.current.id);
    expect(persistedScene.tokens.some(t => t.id === 't1')).toBe(true);
  });

  it('同一 tick 内两条战役 op 消息串行化，不丢 op', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'game-race-'));
    try {
      const s = new SceneStore(path.join(d, 'scenes'));
      const cs = new CampaignStore(path.join(d, 'campaigns'));
      const g = new GameServer(s, cs, { password: 'pw' });
      await g.init();
      // 同一 tick 连续处理两条含战役 op 的消息（模拟 ws 帧合并）
      (g as any).handle(fakeClient('dm'), {
        type: 'op', ops: [{ op: 'addEnemy', entryId: 'MM__Goblin', nameZh: '地精' }],
      });
      (g as any).handle(fakeClient('dm'), {
        type: 'op', ops: [{ op: 'addEnemy', entryId: 'MM__Orc', nameZh: '兽人' }],
      });
      await new Promise(r => setTimeout(r, 0));
      const persisted = await cs.get(g.currentCampaign.id);
      expect(persisted.enemies.map((e: any) => e.entryId))
        .toEqual(expect.arrayContaining(['MM__Goblin', 'MM__Orc']));
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
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

describe('GameServer 迁移（init 收录全部场景 + 幂等性）', () => {
  it('init 将已存在的全部 N 个场景收录进「默认战役」', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'game-migrate-'));
    try {
      const s = new SceneStore(path.join(d, 'scenes'));
      const cs = new CampaignStore(path.join(d, 'campaigns'));
      const a = await s.create('场景A');
      const b = await s.create('场景B');
      const c = await s.create('场景C');
      const g = new GameServer(s, cs, { password: 'pw' });
      await g.init();
      expect(g.currentCampaign.name).toBe('默认战役');
      expect(g.currentCampaign.sceneIds).toEqual(expect.arrayContaining([a.id, b.id, c.id]));
      expect(g.currentCampaign.sceneIds).toHaveLength(3);
      expect((await cs.list())).toHaveLength(1);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('再次 init 不会创建第二个「默认战役」（幂等性）', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'game-migrate-'));
    try {
      const s = new SceneStore(path.join(d, 'scenes'));
      const cs = new CampaignStore(path.join(d, 'campaigns'));
      await s.create('场景A');
      await s.create('场景B');
      const g = new GameServer(s, cs, { password: 'pw' });
      await g.init();
      await g.init();
      const campaigns = await cs.list();
      expect(campaigns.filter(x => x.name === '默认战役')).toHaveLength(1);
      expect(g.currentCampaign.name).toBe('默认战役');
      expect(g.currentCampaign.sceneIds).toHaveLength(2);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('ensurePlayerToken', () => {
  let dir: string;
  let game: GameServer;
  let store: SceneStore;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-'));
    store = new SceneStore(path.join(dir, 'scenes'));
    game = new GameServer(store, new CampaignStore(path.join(dir, 'campaigns')), { password: null });
    await game.init();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('creates a token for a new sessionId with 玩家N name and binds sessionId', () => {
    (game as any).ensurePlayerToken(game.current, 'sess-a');
    const p = game.current.players.find(x => x.sessionId === 'sess-a');
    expect(p).toBeTruthy();
    expect(p!.name).toMatch(/^玩家\d+$/);
    expect(p!.color).toMatch(/^#/);
  });

  it('reuses the existing token for the same sessionId', () => {
    (game as any).ensurePlayerToken(game.current, 'sess-a');
    (game as any).ensurePlayerToken(game.current, 'sess-a');
    expect(game.current.players.filter(x => x.sessionId === 'sess-a')).toHaveLength(1);
  });

  it('assigns increasing 玩家N names', () => {
    (game as any).ensurePlayerToken(game.current, 'sess-a');
    (game as any).ensurePlayerToken(game.current, 'sess-b');
    const names = game.current.players.map(p => p.name).sort();
    expect(names[0]).toBe('玩家1');
    expect(names[1]).toBe('玩家2');
  });
});

describe('player ownership filter', () => {
  let game: GameServer;
  let dir: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-'));
    const store = new SceneStore(path.join(dir, 'scenes'));
    game = new GameServer(store, new CampaignStore(path.join(dir, 'campaigns')), { password: null });
    await game.init();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('player can move own token, cannot move a monster', () => {
    const dmClient = { role: 'dm' as Role, sessionId: '' };
    const player = { role: 'player' as Role, sessionId: 'sess-a' };
    // 放一个怪物
    applyOp(game.current, { op: 'addToken', token: { id: 'm1', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 0, y: 0, size: 100, avatar: '', color: '#fff' } });
    (game as any).ensurePlayerToken(game.current, 'sess-a');
    const p = game.current.players[0];
    expect((game as any).ownsToken(player, p.id)).toBe(true);
    expect((game as any).ownsToken(player, 'm1')).toBe(false);
    expect((game as any).ownsToken(dmClient, 'm1')).toBe(true);
  });

  it('player cannot updatePlayer on another player token', () => {
    (game as any).ensurePlayerToken(game.current, 'sess-a');
    (game as any).ensurePlayerToken(game.current, 'sess-b');
    const pB = game.current.players.find(x => x.sessionId === 'sess-b')!;
    const playerA = { role: 'player' as Role, sessionId: 'sess-a' };
    expect((game as any).ownsToken(playerA, pB.id)).toBe(false);
  });
});

describe('updateSceneUnlock', () => {
  // 复用 ensurePlayerToken 测试的 temp dir 模式
  it('unlocks the current scene and broadcasts', async () => {
    const client = { role: 'dm' as Role, sessionId: '' };
    (game as any).handle(client, { type: 'updateSceneUnlock', sceneId: game.current.id, unlocked: true });
    // handle 异步 → 需微任务刷新
    await new Promise(r => setTimeout(r, 0));
    expect(game.current.unlocked).toBe(true);
  });

  it('unlocks a non-current scene by loading + saving its file', async () => {
    const other = await game.store.create('另一场景');
    (game as any).handle({ role: 'dm' as Role, sessionId: '' }, { type: 'updateSceneUnlock', sceneId: other.id, unlocked: true });
    await new Promise(r => setTimeout(r, 0));
    const loaded = await game.store.get(other.id);
    expect(loaded.unlocked).toBe(true);
  });
});
