import { WebSocket } from 'ws';
import { SceneStore } from './store';
import { Op, Role, Scene } from './types';
import { applyOp, canOp } from './ops';

interface Client {
  ws: WebSocket;
  role: Role;
  name: string;
  dmToken?: string;
}

export class GameServer {
  current: Scene;
  store: SceneStore;
  private clients = new Set<Client>();

  constructor(store: SceneStore, private opts: { password: string | null }) {
    this.store = store;
    this.current = null as unknown as Scene;
  }

  async init(): Promise<void> {
    const last = await this.store.last();
    if (last) {
      try {
        this.current = await this.store.get(last);
        return;
      } catch { /* fallthrough */ }
    }
    const scenes = await this.store.list();
    if (scenes.length > 0) {
      this.current = await this.store.get(scenes[0].id);
      await this.store.setLast(this.current.id);
      return;
    }
    this.current = await this.store.create('默认场景');
    await this.store.setLast(this.current.id);
  }

  roleFor(address: string, dmToken?: string): Role {
    const a = address.replace(/^::ffff:/, '');
    const isLocal = a === '127.0.0.1' || a === '::1';
    if (isLocal) return 'dm';
    if (this.opts.password && dmToken === this.opts.password) return 'dm';
    return 'player';
  }

  attach(ws: any): void {
    const client: Client = { ws, role: 'player', name: '' };
    this.clients.add(client);
    this.broadcastMeta();

    ws.on('message', (raw: string) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      this.handle(client, msg);
    });
    ws.on('close', () => {
      this.clients.delete(client);
      this.broadcastMeta();
    });
  }

  private handle(client: Client, msg: any): void {
    switch (msg.type) {
      case 'init': {
        // Test-only backdoor (DND_TEST_ROLE is never set in production):
        // lets an init message declare its own role so integration tests stay
        // self-contained and portable on hosts without the 127.0.0.2 alias.
        if (process.env.DND_TEST_ROLE === '1' && (msg.role === 'dm' || msg.role === 'player')) {
          client.role = msg.role;
        } else {
          client.role = this.roleFor(this.remoteAddress(client), msg.dmToken);
        }
        client.name = String(msg.name ?? '').slice(0, 20);
        client.ws.send(JSON.stringify({ type: 'state', scene: this.current, role: client.role }));
        this.broadcastMeta();
        return;
      }
      case 'setName': {
        client.name = String(msg.name ?? '').slice(0, 20);
        return;
      }
      case 'op': {
        const ops = Array.isArray(msg.ops) ? msg.ops : [];
        const allowed = ops.filter((op: Op) => canOp(client.role, op));
        const denied = ops.filter((op: Op) => !canOp(client.role, op));
        if (allowed.length > 0) {
          for (const op of allowed) applyOp(this.current, op);
          this.store.save(this.current);
          this.broadcast({ type: 'op', ops: allowed });
        }
        if (denied.length > 0) {
          client.ws.send(JSON.stringify({ type: 'error', message: 'permission denied for some ops' }));
        }
        return;
      }
      case 'switchScene': {
        if (client.role !== 'dm') {
          client.ws.send(JSON.stringify({ type: 'error', message: 'permission denied' }));
          return;
        }
        this.switchScene(String(msg.sceneId)).catch(() => {
          client.ws.send(JSON.stringify({ type: 'error', message: 'scene load failed' }));
        });
        return;
      }
    }
  }

  private async switchScene(id: string): Promise<void> {
    this.store.save(this.current);
    this.current = await this.store.get(id);
    await this.store.setLast(id);
    this.broadcast({ type: 'state', scene: this.current, role: undefined });
  }

  private remoteAddress(client: Client): string {
    return String((client.ws as any)?._socket?.remoteAddress ?? '');
  }

  private broadcast(payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const c of this.clients) {
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
    }
  }

  broadcastMeta(): void {
    this.broadcast({ type: 'meta', online: this.clients.size });
  }
}
