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
  it('玩家可移动 token，DM 可放置 token，两端都收到广播', async () => {
    const dm = await connect(baseUrl);
    dm.send(JSON.stringify({ type: 'init', role: 'dm', dmToken: 'pw' }));
    await once(dm, 'state');

    const player = await connect(baseUrl);
    player.send(JSON.stringify({ type: 'init', role: 'player' }));
    await once(player, 'state');

    // DM places a token; server broadcasts authoritative full state
    dm.send(JSON.stringify({ type: 'op', ops: [{ op: 'addToken', token: { id: 't1', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 0, y: 0, size: 100, avatar: '/api/token/MM__Goblin', color: '#fff' } }] }));
    const b1 = await once(player, 'state');
    expect(b1.scene.tokens.some((t: any) => t.id === 't1')).toBe(true);

    // Player moves that token; both peers receive the resulting full state
    player.send(JSON.stringify({ type: 'op', ops: [{ op: 'moveToken', tokenId: 't1', x: 500, y: 500 }] }));
    const b2 = await once(dm, 'state');
    expect(b2.scene.tokens[0].x).toBe(500);
    expect(b2.scene.tokens[0].y).toBe(500);

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
});
