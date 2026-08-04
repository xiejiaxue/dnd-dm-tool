import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { attachWsServer } from '../src/ws';
import { GameServer } from '../src/game';
import { SceneStore } from '../src/store';

let server: http.Server;
let dmUrl: string;
let playerUrl: string;
let dir: string;
let game: GameServer;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  const store = new SceneStore(path.join(dir, 'scenes'));
  game = new GameServer(store, { password: 'pw' });
  await game.init();
  server = http.createServer((_req, res) => res.end('ok'));
  attachWsServer(server, game);
  // 绑定 0.0.0.0：127.0.0.1 → DM，127.0.0.2（loopback 别名）→ 玩家
  await new Promise<void>(res => server.listen(0, '0.0.0.0', () => res()));
  const addr = server.address() as { port: number };
  dmUrl = `ws://127.0.0.1:${addr.port}/ws`;
  playerUrl = `ws://127.0.0.2:${addr.port}/ws`;
});

afterAll(() => {
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
    const dm = await connect(dmUrl);
    dm.send(JSON.stringify({ type: 'init', dmToken: 'pw' }));   // localhost 已是 dm，这里再验证 token
    await once(dm, 'state');

    const player = await connect(playerUrl);
    player.send(JSON.stringify({ type: 'init' }));
    const pState = await once(player, 'state');

    // DM 放置一个 token
    dm.send(JSON.stringify({ type: 'op', ops: [{ op: 'addToken', token: { id: 't1', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 0, y: 0, size: 100, avatar: '/api/token/MM__Goblin', color: '#fff' } }] }));
    const b1 = await once(player, 'op');
    expect(b1.ops[0].op).toBe('addToken');

    // 玩家移动该 token
    player.send(JSON.stringify({ type: 'op', ops: [{ op: 'moveToken', tokenId: 't1', x: 500, y: 500 }] }));
    const b2 = await once(dm, 'op');
    expect(b2.ops[0]).toMatchObject({ op: 'moveToken', x: 500, y: 500 });

    dm.close();
    player.close();
  });

  it('玩家尝试 DM 专属 op 被拒绝（收到 error）', async () => {
    const player = await connect(playerUrl);
    player.send(JSON.stringify({ type: 'init' }));
    await once(player, 'state');
    player.send(JSON.stringify({ type: 'op', ops: [{ op: 'advanceTurn' }] }));
    const err = await once(player, 'error');
    expect(err.message).toMatch(/permission/i);
    player.close();
  });

  it('DM 切换场景，所有客户端收到新 state', async () => {
    const dm = await connect(dmUrl);
    dm.send(JSON.stringify({ type: 'init', dmToken: 'pw' }));
    await once(dm, 'state');

    const player = await connect(playerUrl);
    player.send(JSON.stringify({ type: 'init' }));
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
});
