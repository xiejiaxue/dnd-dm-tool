import { WebSocket } from 'ws';
import { SceneStore } from './store';
import { CampaignStore } from './campaign-store';
import { Op, Role, Scene, Campaign } from './types';
import { applyCampaignOp, isCampaignOp } from './campaign-ops';
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
  campaignStore: CampaignStore;
  currentCampaign: Campaign;
  private clients = new Set<Client>();
  // 串行化 op 应用：保证 重读→apply→save 严格顺序执行，避免同一事件循环
  // tick 内两条战役 op 消息（ws 帧合并）读到同一旧状态、后者覆盖前者丢 op。
  private opQueue: Promise<void> = Promise.resolve();

  constructor(store: SceneStore, campaignStore: CampaignStore, private opts: { password: string | null }) {
    this.store = store;
    this.campaignStore = campaignStore;
    this.current = null as unknown as Scene;
    this.currentCampaign = null as unknown as Campaign;
  }

  async init(): Promise<void> {
    // 迁移：无战役时自动建「默认战役」收录全部场景
    if ((await this.campaignStore.list()).length === 0) {
      const scenes = await this.store.list();
      const def = await this.campaignStore.create('默认战役');
      for (const s of scenes) await this.campaignStore.assignScene(def.id, s.id);
    }
    // 定位当前场景（last-scene 或首个）
    let sceneId: string | null = await this.store.last();
    if (!sceneId) {
      const scenes = await this.store.list();
      sceneId = scenes.length > 0 ? scenes[0].id : null;
    }
    if (sceneId) {
      try {
        this.current = await this.store.get(sceneId);
        this.currentCampaign = await this.campaignForScene(sceneId);
        return;
      } catch { /* fallthrough */ }
    }
    this.current = await this.store.create('默认场景');
    await this.store.setLast(this.current.id);
    this.currentCampaign = await this.campaignForScene(this.current.id);
  }

  private async campaignForScene(sceneId: string): Promise<Campaign> {
    for (const c of await this.campaignStore.all()) {
      if (c.sceneIds.includes(sceneId)) return c;
    }
    const list = await this.campaignStore.list();
    const target = list.length > 0 ? list[0].id : (await this.campaignStore.create('默认战役')).id;
    await this.campaignStore.assignScene(target, sceneId);
    return this.campaignStore.get(target);
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
        client.ws.send(JSON.stringify({ type: 'state', scene: this.current, role: client.role, campaign: this.currentCampaign }));
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
          const campaignOps = allowed.filter(isCampaignOp);
          const sceneOps = allowed.filter((op: Op) => !isCampaignOp(op));
          this.opQueue = this.opQueue
            .then(() => this.applyAllowedOps(campaignOps, sceneOps))
            .catch(() => {
              client.ws.send(JSON.stringify({ type: 'error', message: 'op apply failed' }));
            });
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
      case 'switchCampaign': {
        if (client.role !== 'dm') {
          client.ws.send(JSON.stringify({ type: 'error', message: 'permission denied' }));
          return;
        }
        this.switchCampaign(String(msg.campaignId)).catch(() => {
          client.ws.send(JSON.stringify({ type: 'error', message: 'campaign load failed' }));
        });
        return;
      }
    }
  }

  private async switchScene(id: string): Promise<void> {
    this.store.save(this.current);
    this.current = await this.store.get(id);
    await this.store.setLast(id);
    this.broadcast({ type: 'state', scene: this.current, campaign: this.currentCampaign });
  }

  private async switchCampaign(id: string): Promise<void> {
    this.store.save(this.current);
    const campaign = await this.campaignStore.get(id);
    this.currentCampaign = campaign;
    let scene = this.current;
    if (!campaign.sceneIds.includes(this.current.id)) {
      scene = campaign.sceneIds.length > 0
        ? await this.store.get(campaign.sceneIds[0])
        : await this.store.create('未命名场景');
      if (!campaign.sceneIds.includes(scene.id)) {
        campaign.sceneIds.push(scene.id);
        this.campaignStore.save(campaign);
      }
    }
    this.current = scene;
    await this.store.setLast(this.current.id);
    this.broadcast({ type: 'state', scene: this.current, campaign: this.currentCampaign });
  }

  private async applyAllowedOps(campaignOps: Op[], sceneOps: Op[]): Promise<void> {
    if (campaignOps.length > 0) {
      // 重读磁盘上的当前战役，吸收 REST（如 assignSceneToCampaign）写入的变更，
      // 避免用陈旧的内存对象覆盖磁盘导致归属/敌人库丢失。
      this.currentCampaign = await this.campaignStore.get(this.currentCampaign.id);
      for (const op of campaignOps) applyCampaignOp(this.currentCampaign, op);
      this.campaignStore.save(this.currentCampaign);
    }
    if (sceneOps.length > 0) {
      for (const op of sceneOps) applyOp(this.current, op);
      this.store.save(this.current);
    }
    this.broadcast({ type: 'state', scene: this.current, campaign: this.currentCampaign });
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

  clientsCount(): number {
    return this.clients.size;
  }
}
