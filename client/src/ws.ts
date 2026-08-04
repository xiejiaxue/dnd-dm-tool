import { useEffect, useRef, useState } from 'react';
import type { Op, Role, Scene } from './types';

export interface SceneState {
  scene: Scene | null;
  role: Role;
  online: number;
  connected: boolean;
}

type Listener = (msg: any) => void;

class Connection {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private retry = 0;
  private shouldReconnect = true;
  private dmToken: string | null = localStorage.getItem('dnd-dm-token');

  constructor() {
    this.connect();
  }

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      this.retry = 0;
      this.sendControl({ type: 'init', dmToken: this.dmToken ?? undefined });
    };
    this.ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data as string); } catch { return; }
      for (const l of this.listeners) l(msg);
    };
    this.ws.onclose = () => {
      if (!this.shouldReconnect) return;
      const delay = Math.min(1000 * 2 ** this.retry, 10000);
      this.retry += 1;
      setTimeout(() => this.connect(), delay);
    };
  }

  sendOps(ops: Op[]): void {
    this.sendControl({ type: 'op', ops });
  }
  sendControl(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  onMessage(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  setDmToken(t: string): void {
    this.dmToken = t;
    localStorage.setItem('dnd-dm-token', t);
  }
}

const connection = new Connection();

export function useScene(): SceneState {
  const [state, setState] = useState<SceneState>({ scene: null, role: 'player', online: 0, connected: false });
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    return connection.onMessage((msg) => {
      const cur = stateRef.current;
      if (msg.type === 'state') {
        setState({ ...cur, scene: msg.scene, role: msg.role ?? cur.role, connected: true });
      } else if (msg.type === 'meta') {
        setState({ ...cur, online: msg.online, connected: true });
      } else if (msg.type === 'error') {
        console.warn('[ws]', msg.message);
      }
    });
  }, []);

  return state;
}

export { connection };
