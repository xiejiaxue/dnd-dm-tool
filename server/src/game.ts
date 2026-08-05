import { WebSocket } from 'ws';
import { SceneStore } from './store';
import { CampaignStore } from './campaign-store';
import { Op, Role, Scene, Campaign } from './types';
import { applyCampaignOp, isCampaignOp, CampaignOp } from './campaign-ops';
import { applyOp, canOp } from './ops';
import { sortInitiative } from './initiative';
import { newId } from './scene';

interface Client {
  ws: WebSocket;
  role: Role;
  name: string;
  sessionId: string;
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

  constructor(
    store: SceneStore,
    campaignStore: CampaignStore,
    private opts: { password: string | null },
    // Optional: used to auto-fill max HP for placed monster tokens. Structural
    // so tests can construct GameServer without wiring the entry service.
    private entries?: { get(type: 'monster', id: string): Promise<any> },
  ) {
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

  // Ensure the player's token exists in this scene, creating it if missing.
  // Returns true if the scene's players array was mutated (needs a save).
  private ensurePlayerToken(scene: Scene, sessionId: string): boolean {
    if (scene.players.some(p => p.sessionId === sessionId)) return false;
    let n = 1;
    for (const p of scene.players) {
      const m = /^玩家(\d+)$/.exec(p.name);
      if (m) n = Math.max(n, Number(m[1]) + 1);
    }
    const colors = ['#e53e3e', '#38a169', '#3182ce', '#d69e2e', '#805ad5', '#dd6b20', '#319795', '#d53f8c'];
    scene.players.push({
      id: newId('p'),
      kind: 'player',
      name: `玩家${n}`,
      entryId: null,
      x: 150 + (n * 40) % 600,
      y: 150 + (n * 30) % 400,
      size: 100,
      avatar: '',
      color: colors[n % colors.length],
      sessionId,
    });
    return true;
  }

  // Ensure every connected player has a token in the given scene.
  private async ensureAllPlayerTokens(scene: Scene): Promise<void> {
    let changed = false;
    for (const c of this.clients) {
      if (c.role === 'player' && c.sessionId && this.ensurePlayerToken(scene, c.sessionId)) changed = true;
    }
    if (changed) this.store.save(scene);
  }

  roleFor(address: string, dmToken?: string): Role {
    const a = address.replace(/^::ffff:/, '');
    const isLocal = a === '127.0.0.1' || a === '::1';
    if (isLocal) return 'dm';
    if (this.opts.password && dmToken === this.opts.password) return 'dm';
    return 'player';
  }

  attach(ws: any): void {
    const client: Client = { ws, role: 'player', name: '', sessionId: '' };
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
        client.sessionId = String(msg.sessionId ?? '');
        // Test-only backdoor (DND_TEST_ROLE is never set in production):
        // lets an init message declare its own role so integration tests stay
        // self-contained and portable on hosts without the 127.0.0.2 alias.
        if (process.env.DND_TEST_ROLE === '1' && (msg.role === 'dm' || msg.role === 'player')) {
          client.role = msg.role;
        } else {
          client.role = this.roleFor(this.remoteAddress(client), msg.dmToken);
        }
        client.name = String(msg.name ?? '').slice(0, 20);
        // Ensure a player reconnecting (or joining) has a token in the current
        // scene; persist + broadcast only when a new token was created.
        if (client.role === 'player' && client.sessionId && this.ensurePlayerToken(this.current, client.sessionId)) {
          this.store.save(this.current);
          this.broadcast({ type: 'state', scene: this.current, campaign: this.currentCampaign });
        }
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
      case 'renameScene': {
        if (client.role !== 'dm') {
          client.ws.send(JSON.stringify({ type: 'error', message: 'permission denied' }));
          return;
        }
        this.renameScene(String(msg.sceneId), String(msg.name ?? '').slice(0, 60)).catch(() => {
          client.ws.send(JSON.stringify({ type: 'error', message: 'scene rename failed' }));
        });
        return;
      }
      case 'rollInitiative': {
        if (client.role !== 'dm') {
          client.ws.send(JSON.stringify({ type: 'error', message: 'permission denied' }));
          return;
        }
        this.rollInitiative().catch(() => {
          client.ws.send(JSON.stringify({ type: 'error', message: 'initiative roll failed' }));
        });
        return;
      }
    }
  }

  private async switchScene(id: string): Promise<void> {
    this.store.save(this.current);
    // Spec §7: only scenes within the current campaign can be switched to. If
    // the DM switches to an unassigned scene, reconcile its campaign (move it
    // into the current campaign) — graceful, matching campaignForScene.
    if (!this.currentCampaign.sceneIds.includes(id)) {
      await this.campaignStore.assignScene(this.currentCampaign.id, id);
      // Reload so the broadcast campaign reflects the reconciled sceneIds.
      this.currentCampaign = await this.campaignStore.get(this.currentCampaign.id);
    }
    this.current = await this.store.get(id);
    await this.store.setLast(id);
    await this.ensureAllPlayerTokens(this.current);
    this.broadcast({ type: 'state', scene: this.current, campaign: this.currentCampaign });
  }

  private async switchCampaign(id: string): Promise<void> {
    this.store.save(this.current);
    const campaign = await this.campaignStore.get(id);
    let scene: Scene;
    if (!campaign.sceneIds.includes(this.current.id)) {
      // Resolve the target scene FIRST and only then commit currentCampaign —
      // a missing/corrupt scene must never leave currentCampaign pointing at a
      // campaign whose scene failed to load. Skip ids whose file was deleted
      // after the campaign was last saved (the DELETE route cleanup may not
      // have run), pick the first existing one, and persist the pruned ids.
      const existing: Scene[] = [];
      for (const sid of campaign.sceneIds) {
        try { existing.push(await this.store.get(sid)); } catch { /* skip missing */ }
      }
      campaign.sceneIds = existing.map(s => s.id);
      if (existing.length === 0) {
        scene = await this.store.create('未命名场景');
        campaign.sceneIds.push(scene.id);
      } else {
        scene = existing[0];
      }
      this.campaignStore.save(campaign);
    } else {
      scene = this.current;
    }
    this.currentCampaign = campaign;
    this.current = scene;
    await this.store.setLast(this.current.id);
    await this.ensureAllPlayerTokens(this.current);
    this.broadcast({ type: 'state', scene: this.current, campaign: this.currentCampaign });
  }

  // Rename a scene. The current scene updates in memory and is broadcast so the
  // TopBar reflects it immediately; other scenes are renamed on disk and the
  // switcher picks the new name up on its next list reload.
  private async renameScene(sceneId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('empty scene name');
    if (sceneId === this.current.id) {
      this.current.name = trimmed;
      this.store.save(this.current);
      this.broadcast({ type: 'state', scene: this.current, campaign: this.currentCampaign });
      return;
    }
    const scene = await this.store.get(sceneId);
    scene.name = trimmed;
    this.store.save(scene);
  }

  // D&D 5e initiative for every monster in the scene: d20 + dex modifier
  // (modifier from the stat block's dex score). Re-rolling updates existing
  // entries by tokenId; new monsters get appended. All clients see the roll.
  private async rollInitiative(): Promise<void> {
    const rolls: { tokenId: string; name: string; value: number }[] = [];
    for (const t of this.current.tokens) {
      if (t.kind !== 'monster') continue;
      let mod = 0;
      if (this.entries && t.entryId) {
        try {
          const e = await this.entries.get('monster', t.entryId);
          const dex = Number(e?.dex);
          if (Number.isFinite(dex)) mod = Math.floor((dex - 10) / 2);
        } catch { /* unknown monster → +0 */ }
      }
      rolls.push({
        tokenId: t.id,
        name: t.number != null ? `${t.name} #${t.number}` : t.name,
        value: Math.floor(Math.random() * 20) + 1 + mod,
      });
    }
    for (const r of rolls) {
      const existing = this.current.initiative.find(e => e.tokenId === r.tokenId);
      if (existing) {
        existing.name = r.name;
        existing.value = r.value;
      } else {
        this.current.initiative.push({
          id: newId('ini'),
          name: r.name,
          value: r.value,
          source: 'dm',
          sessionId: null,
          tokenId: r.tokenId,
          active: false,
        });
      }
    }
    this.current.initiative = sortInitiative(this.current.initiative);
    this.store.save(this.current);
    this.broadcast({ type: 'state', scene: this.current, campaign: this.currentCampaign });
  }

  private async applyAllowedOps(campaignOps: CampaignOp[], sceneOps: Op[]): Promise<void> {
    if (campaignOps.length > 0) {
      // 重读磁盘上的当前战役，吸收 REST（如 assignSceneToCampaign）写入的变更，
      // 避免用陈旧的内存对象覆盖磁盘导致归属/敌人库丢失。
      this.currentCampaign = await this.campaignStore.get(this.currentCampaign.id);
      for (const op of campaignOps) applyCampaignOp(this.currentCampaign, op);
      this.campaignStore.save(this.currentCampaign);
    }
    if (sceneOps.length > 0) {
      // Auto-fill max HP for freshly placed monster tokens from the 5e stat
      // block (single authoritative point covering every placement path).
      for (const op of sceneOps) {
        if (op.op === 'addToken' && this.entries && op.token.kind === 'monster' && op.token.entryId && !op.token.hp) {
          try {
            const e = await this.entries.get('monster', op.token.entryId);
            const avg = Number(e?.hp?.average);
            if (Number.isFinite(avg) && avg > 0) {
              op.token = { ...op.token, hp: { current: avg, max: avg } };
            }
          } catch { /* leave hp unset if the stat block can't be loaded */ }
        }
      }
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
