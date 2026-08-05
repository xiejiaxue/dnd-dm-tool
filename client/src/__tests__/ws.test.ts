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
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:3001' });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('监听器注册晚于 state 到达时，仍能收到补发的 state', async () => {
    const { connection } = await import('../ws');
    await new Promise(r => setTimeout(r, 10)); // 等 onopen + init
    const ws = FakeWS.instances[0];
    // 服务端在监听器注册前就返回了 state
    recv(ws, { type: 'state', scene, role: 'dm' });

    const got: any[] = [];
    connection.onMessage(m => got.push(m));
    const state = got.find(m => m.type === 'state');
    expect(state).toBeTruthy();
    expect(state.scene.name).toBe('测试场景');
    expect(state.role).toBe('dm');
  });

  it('useScene 初始状态能读取已到达的 lastState', async () => {
    const { connection } = await import('../ws');
    await new Promise(r => setTimeout(r, 10));
    recv(FakeWS.instances[0], { type: 'state', scene, role: 'player' });
    expect(connection.lastState?.scene.name).toBe('测试场景');
    expect(connection.connected).toBe(true);
  });

  it('断线后 connected 复位为 false', async () => {
    const { connection } = await import('../ws');
    await new Promise(r => setTimeout(r, 10));
    recv(FakeWS.instances[0], { type: 'state', scene, role: 'dm' });
    expect(connection.connected).toBe(true);
    FakeWS.instances[0].onclose?.();
    expect(connection.connected).toBe(false);
  });
});
