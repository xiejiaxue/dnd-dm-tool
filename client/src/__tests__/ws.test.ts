import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const scene = {
  id: 's1',
  name: '测试场景',
  mapImage: null,
  mapSize: [1600, 1200],
  grid: { size: 100, color: '#00000040', offset: [0, 0], snap: true },
  playArea: { x: 0, y: 0, w: 1600, h: 1200 },
  tokens: [],
  players: [],
  walls: [],
  initiative: [],
  favorites: [],
};

// Fake browser WebSocket that opens asynchronously and records sent frames.
class FakeWS {
  static instances: FakeWS[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
    setTimeout(() => {
      this.readyState = FakeWS.OPEN;
      this.onopen?.();
    }, 0);
  }
  send(data: string) { this.sent.push(data); }
  close() { this.onclose?.(); }
}

function recv(ws: FakeWS, data: unknown) {
  ws.onmessage?.({ data: JSON.stringify(data) });
}

describe('Connection 竞态修复（订阅晚于初始 state）', () => {
  beforeEach(() => {
    vi.resetModules();
    FakeWS.instances = [];
    vi.stubGlobal('WebSocket', FakeWS);
    vi.stubGlobal('location', { protocol: 'https:', host: 'table.example' });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('只有选定 room URL 后才建立连接', async () => {
    const { connection } = await import('../ws');
    expect(FakeWS.instances).toHaveLength(0);
    connection.connect('first-room');
    await new Promise(r => setTimeout(r, 10));
    expect(FakeWS.instances).toHaveLength(1);
    expect(FakeWS.instances[0].url).toBe('wss://table.example/api/campaigns/first-room/ws');
    connection.disconnect();
  });

  it('监听器注册晚于 state 到达时，仍能收到补发的 state', async () => {
    const { connection } = await import('../ws');
    connection.connect('test-room');
    await new Promise(r => setTimeout(r, 10));
    const ws = FakeWS.instances[0];
    // 服务端在监听器注册前就返回了 state
    recv(ws, { type: 'state', scene, role: 'dm' });

    const got: any[] = [];
    connection.onMessage(m => got.push(m));
    const state = got.find(m => m.type === 'state');
    expect(state).toBeTruthy();
    expect(state.scene.name).toBe('测试场景');
    expect(state.role).toBe('dm');
    expect(ws.url).toBe('wss://table.example/api/campaigns/test-room/ws');
    expect(ws.sent.map(frame => JSON.parse(frame))).toContainEqual({ type: 'capabilities', patches: 1 });
    connection.disconnect();
  });

  it('增量聊天帧追加消息并推进版本，版本跳号时请求重同步', async () => {
    const { connection } = await import('../ws');
    connection.connect('chat-room');
    await new Promise(r => setTimeout(r, 10));
    const ws = FakeWS.instances[0];
    recv(ws, { type: 'state', scene, role: 'dm', revision: 4, messages: [] });
    const message = { id: 'm1', campaignId: 'c', userId: 'u', author: 'A', kind: 'chat', text: 'hi', visibility: 'public', createdAt: 1 };
    recv(ws, { type: 'chat', revision: 5, message });
    expect(connection.lastState?.messages.map(m => m.id)).toEqual(['m1']);
    expect(connection.lastState?.revision).toBe(5);
    // A private message for someone else only bumps the revision.
    recv(ws, { type: 'chat', revision: 6 });
    expect(connection.lastState?.revision).toBe(6);
    expect(connection.lastState?.messages).toHaveLength(1);
    recv(ws, { type: 'chat', revision: 9, message: { ...message, id: 'm2' } });
    expect(ws.sent.map(frame => JSON.parse(frame))).toContainEqual({ type: 'resync' });
    expect(connection.lastState?.messages).toHaveLength(1);
    connection.disconnect();
  });

  it('useScene 初始状态能读取已到达的 lastState', async () => {
    const { connection } = await import('../ws');
    connection.connect('test-room');
    await new Promise(r => setTimeout(r, 10));
    recv(FakeWS.instances[0], { type: 'state', scene, role: 'player' });
    expect(connection.lastState?.scene.name).toBe('测试场景');
    expect(connection.connected).toBe(true);
    connection.disconnect();
  });

  it('断线后 connected 复位为 false', async () => {
    const { connection } = await import('../ws');
    connection.connect('test-room');
    await new Promise(r => setTimeout(r, 10));
    recv(FakeWS.instances[0], { type: 'state', scene, role: 'dm' });
    expect(connection.connected).toBe(true);
    FakeWS.instances[0].onclose?.();
    expect(connection.connected).toBe(false);
    connection.disconnect();
  });

  it('操作会先在本机显示，并由小型 patch 确认而不是等待整份场景', async () => {
    const { connection } = await import('../ws');
    connection.connect('test-room');
    await new Promise(r => setTimeout(r, 10));
    const ws = FakeWS.instances[0];
    recv(ws, { type: 'state', scene, role: 'dm', revision: 0 });

    connection.sendOps([{ op: 'updateMapScale', mapScale: 1.25 }]);
    expect(connection.lastState?.scene.mapScale).toBe(1.25);
    const command = ws.sent.map(frame => JSON.parse(frame)).find(frame => frame.type === 'op');
    expect(command?.id).toEqual(expect.any(String));

    recv(ws, { type: 'ack', commandId: command.id, revision: 1 });
    recv(ws, { type: 'patch', revision: 1, ops: [{ op: 'updateMapScale', mapScale: 1.25 }] });
    expect(connection.lastState?.revision).toBe(1);
    expect(connection.lastState?.scene.mapScale).toBe(1.25);
    connection.disconnect();
  });

  it('被服务器拒绝的乐观操作会回滚', async () => {
    const { connection } = await import('../ws');
    connection.connect('test-room');
    await new Promise(r => setTimeout(r, 10));
    const ws = FakeWS.instances[0];
    recv(ws, { type: 'state', scene, role: 'dm', revision: 0 });

    connection.sendOps([{ op: 'updateMapScale', mapScale: 1.5 }]);
    const command = ws.sent.map(frame => JSON.parse(frame)).find(frame => frame.type === 'op');
    recv(ws, { type: 'error', commandId: command.id, code: 'FORBIDDEN', message: '不允许' });
    expect(connection.lastState?.scene.mapScale).toBeUndefined();
    connection.disconnect();
  });
});
