import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { attachWsServer } from '../src/ws';
import { GameServer } from '../src/game';
import { SceneStore } from '../src/store';
import { CampaignStore } from '../src/campaign-store';

let server: http.Server;
let baseUrl: string;
let dir: string;
let game: GameServer;

beforeAll(async () => {
  // Test-only backdoor: init messages may declare their own role.
  // Keeps the integration test self-contained and portable on hosts where the
  // 127.0.0.2 loopback alias is unreachable. Never set in production.
  process.env.DND_TEST_ROLE = '1';
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  const store = new SceneStore(path.join(dir, 'scenes'));
  const campaignStore = new CampaignStore(path.join(dir, 'campaigns'));
  game = new GameServer(store, campaignStore, { password: 'pw' });
  await game.init();
  server = http.createServer((_req, res) => res.end('ok'));
  attachWsServer(server, game);
  await new Promise<void>(res => server.listen(0, '127.0.0.1', () => res()));
  const addr = server.address() as { port: number };
  baseUrl = `ws://127.0.0.1:${addr.port}/ws`;
});

afterAll(() => {
  delete process.env.DND_TEST_ROLE;
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}
function once(ws: WebSocket, type: string): Promise<any> {
  return new Promise((resolve) => {
    const onMsg = (raw: string) => {
      const m = JSON.parse(raw);
      if (m.type === type) {
        ws.off('message', onMsg);
        resolve(m);
      }
    };
    ws.on('message', onMsg);
  });
}

describe('WebSocket 同步', () => {
  it('玩家自动创建 token，可移动自己的 token，DM 可放置怪物', async () => {
    const dm = await connect(baseUrl);
    dm.send(JSON.stringify({ type: 'init', role: 'dm', dmToken: 'pw' }));
    await once(dm, 'state');

    const player = await connect(baseUrl);
    player.send(JSON.stringify({ type: 'init', role: 'player', sessionId: 'ps-1' }));
    const pState = await once(player, 'state');
    const my = pState.scene.players.find((x: any) => x.sessionId === 'ps-1');
    expect(my).toBeTruthy();

    // 玩家拖自己的 token → 广播
    player.send(JSON.stringify({ type: 'op', ops: [{ op: 'moveToken', tokenId: my.id, x: 500, y: 500 }] }));
    const b2 = await once(dm, 'state');
    expect(b2.scene.players.find((x: any) => x.id === my.id)).toMatchObject({ x: 500, y: 500 });

    // DM 放置一个怪物
    dm.send(JSON.stringify({ type: 'op', ops: [{ op: 'addToken', token: { id: 't1', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 0, y: 0, size: 100, avatar: '/api/token/MM__Goblin', color: '#fff' } }] }));
    await once(player, 'state');

    // 玩家尝试拖怪物 → 被拒
    player.send(JSON.stringify({ type: 'op', ops: [{ op: 'moveToken', tokenId: 't1', x: 100, y: 100 }] }));
    const err = await once(player, 'error');
    expect(err.message).toMatch(/permission/i);

    dm.close();
    player.close();
  });

  it('玩家尝试 DM 专属 op 被拒绝（收到 error）', async () => {
    const player = await connect(baseUrl);
    player.send(JSON.stringify({ type: 'init', role: 'player' }));
    await once(player, 'state');
    player.send(JSON.stringify({ type: 'op', ops: [{ op: 'advanceTurn' }] }));
    const err = await once(player, 'error');
    expect(err.message).toMatch(/permission/i);
    player.close();
  });

  it('DM 切换场景，所有客户端收到新 state', async () => {
    const dm = await connect(baseUrl);
    dm.send(JSON.stringify({ type: 'init', role: 'dm', dmToken: 'pw' }));
    await once(dm, 'state');

    const player = await connect(baseUrl);
    player.send(JSON.stringify({ type: 'init', role: 'player' }));
    await once(player, 'state');

    const scene = await game.store.create('新场景');
    dm.send(JSON.stringify({ type: 'switchScene', sceneId: scene.id }));
    const s1 = await once(dm, 'state');
    const s2 = await once(player, 'state');
    expect(s1.scene.name).toBe('新场景');
    expect(s2.scene.name).toBe('新场景');

    dm.close();
    player.close();
  });

  it('DM 加入敌人库，玩家收到含敌人的 state', async () => {
    const dm = await connect(baseUrl);
    dm.send(JSON.stringify({ type: 'init', role: 'dm', dmToken: 'pw' }));
    await once(dm, 'state');
    const player = await connect(baseUrl);
    player.send(JSON.stringify({ type: 'init', role: 'player' }));
    await once(player, 'state');

    dm.send(JSON.stringify({ type: 'op', ops: [{ op: 'addEnemy', entryId: 'MM__Goblin', nameZh: '地精' }] }));
    const b = await once(player, 'state');
    expect(b.campaign.enemies.some((e: any) => e.entryId === 'MM__Goblin')).toBe(true);

    dm.close();
    player.close();
  });

  it('玩家尝试加敌人被拒绝', async () => {
    const player = await connect(baseUrl);
    player.send(JSON.stringify({ type: 'init', role: 'player' }));
    await once(player, 'state');
    player.send(JSON.stringify({ type: 'op', ops: [{ op: 'addEnemy', entryId: 'x', nameZh: 'y' }] }));
    const err = await once(player, 'error');
    expect(err.message).toMatch(/permission/i);
    player.close();
  });

  it('DM 切换战役，两端收到新战役与场景', async () => {
    const dm = await connect(baseUrl);
    dm.send(JSON.stringify({ type: 'init', role: 'dm', dmToken: 'pw' }));
    await once(dm, 'state');
    const player = await connect(baseUrl);
    player.send(JSON.stringify({ type: 'init', role: 'player' }));
    await once(player, 'state');

    const campaign = await game.campaignStore.create('新战役');
    const scene = await game.store.create('战役场景');
    await game.campaignStore.assignScene(campaign.id, scene.id);

    dm.send(JSON.stringify({ type: 'switchCampaign', campaignId: campaign.id }));
    const s1 = await once(dm, 'state');
    const s2 = await once(player, 'state');
    expect(s1.campaign.name).toBe('新战役');
    expect(s2.scene.name).toBe('战役场景');

    dm.close();
    player.close();
  });

  it('REST 归属场景后 DM 发战役 op：重读磁盘，归属不被覆盖', async () => {
    const dm = await connect(baseUrl);
    dm.send(JSON.stringify({ type: 'init', role: 'dm', dmToken: 'pw' }));
    await once(dm, 'state');

    // 模拟 REST 归属：新建场景并直接写磁盘，内存 currentCampaign 不更新
    const newScene = await game.store.create('REST 新场景');
    const campaignId = game.currentCampaign.id;
    await game.campaignStore.assignScene(campaignId, newScene.id);
    // 复现前提：内存 currentCampaign.sceneIds 仍是旧的（不含新场景）
    expect(game.currentCampaign.sceneIds).not.toContain(newScene.id);

    dm.send(JSON.stringify({ type: 'op', ops: [{ op: 'addEnemy', entryId: 'MM__Orc', nameZh: '兽人' }] }));
    const b = await once(dm, 'state');
    expect(b.campaign.sceneIds).toContain(newScene.id);
    expect(b.campaign.enemies.some((e: any) => e.entryId === 'MM__Orc')).toBe(true);
    // 磁盘上的战役仍保留该归属（旧实现会在此处被内存覆盖而丢失）
    const persisted = await game.campaignStore.get(campaignId);
    expect(persisted.sceneIds).toContain(newScene.id);

    dm.close();
  });

  it('sceneIds[0] 场景被删后 switchCampaign 落到存活场景且不报错（Findings 1+2 回归）', async () => {
    const dm = await connect(baseUrl);
    dm.send(JSON.stringify({ type: 'init', role: 'dm', dmToken: 'pw' }));
    await once(dm, 'state');

    const campaign = await game.campaignStore.create('删除场景战役');
    const s1 = await game.store.create('战役场景 1');
    const s2 = await game.store.create('战役场景 2');
    await game.campaignStore.assignScene(campaign.id, s1.id);
    await game.campaignStore.assignScene(campaign.id, s2.id);
    // 复现前提：sceneIds[0]（s1）的磁盘文件被删除，但战役归属尚未清理
    await game.store.delete(s1.id);
    expect((await game.campaignStore.get(campaign.id)).sceneIds).toContain(s1.id);

    dm.send(JSON.stringify({ type: 'switchCampaign', campaignId: campaign.id }));
    const st = await once(dm, 'state');
    // 一致状态：currentCampaign 已是目标战役，current 场景为存活的 s2，无 error
    expect(st.campaign.name).toBe('删除场景战役');
    expect(st.campaign.sceneIds).toEqual([s2.id]);
    expect(st.scene.id).toBe(s2.id);
    expect(st.scene.name).toBe('战役场景 2');

    dm.close();
  });

  it('DM 自动随机先攻：场景内怪物获得 d20 先攻值并进入先攻列表', async () => {
    const dm = await connect(baseUrl);
    dm.send(JSON.stringify({ type: 'init', role: 'dm', dmToken: 'pw' }));
    await once(dm, 'state');

    dm.send(JSON.stringify({ type: 'op', ops: [
      { op: 'addToken', token: { id: 'ri-a', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 0, y: 0, size: 100, avatar: '', color: '#fff' } },
      { op: 'addToken', token: { id: 'ri-b', kind: 'monster', name: '兽人', entryId: 'MM__Orc', x: 0, y: 0, size: 100, avatar: '', color: '#fff' } },
    ] }));
    await once(dm, 'state');

    dm.send(JSON.stringify({ type: 'rollInitiative' }));
    const st = await once(dm, 'state');
    const a = st.scene.initiative.find((e: any) => e.tokenId === 'ri-a');
    const b = st.scene.initiative.find((e: any) => e.tokenId === 'ri-b');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    // 测试环境未接 entries（敏捷 +0），d20 范围 1..20
    expect(a.value).toBeGreaterThanOrEqual(1);
    expect(a.value).toBeLessThanOrEqual(20);
    expect(b.value).toBeGreaterThanOrEqual(1);
    expect(b.value).toBeLessThanOrEqual(20);

    dm.close();
  });

  it('玩家改他人 token 被拒；提交先攻自动关联自己的 token', async () => {
    const player = await connect(baseUrl);
    player.send(JSON.stringify({ type: 'init', role: 'player', sessionId: 'ps-2' }));
    const st = await once(player, 'state');
    const my = st.scene.players.find((x: any) => x.sessionId === 'ps-2');

    // 尝试改他人的（不存在的）token
    player.send(JSON.stringify({ type: 'op', ops: [{ op: 'updatePlayer', tokenId: 'nobody', patch: { name: 'X' } }] }));
    const err = await once(player, 'error');
    expect(err.message).toMatch(/permission/i);

    // 提交先攻：tokenId 为自己的
    player.send(JSON.stringify({ type: 'op', ops: [{ op: 'submitInitiative', name: my.name, value: 14, tokenId: my.id, sessionId: 'ps-2' }] }));
    const st2 = await once(player, 'state');
    expect(st2.scene.initiative.some((e: any) => e.tokenId === my.id && e.value === 14)).toBe(true);

    player.close();
  });

  it('切场景后玩家 token 跟随到新场景', async () => {
    const dm = await connect(baseUrl);
    dm.send(JSON.stringify({ type: 'init', role: 'dm', dmToken: 'pw' }));
    await once(dm, 'state');
    const player = await connect(baseUrl);
    player.send(JSON.stringify({ type: 'init', role: 'player', sessionId: 'ps-3' }));
    await once(player, 'state');

    const campaign = await game.campaignStore.create('战役B');
    const scene = await game.store.create('场景B');
    await game.campaignStore.assignScene(campaign.id, scene.id);
    dm.send(JSON.stringify({ type: 'switchCampaign', campaignId: campaign.id }));
    const s1 = await once(dm, 'state');
    const s2 = await once(player, 'state');
    expect(s1.scene.players.some((x: any) => x.sessionId === 'ps-3')).toBe(true);
    expect(s2.scene.players.some((x: any) => x.sessionId === 'ps-3')).toBe(true);

    dm.close();
    player.close();
  });
});
