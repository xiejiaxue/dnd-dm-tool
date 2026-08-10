import { DurableObject } from 'cloudflare:workers';
import type { Campaign, Op, PlayerToken, Scene } from '../../shared/types';
import {
  activeCampaign,
  activeScene,
  addScene,
  applyOperation,
  authorizeOperation,
  createInitialRoomState,
  deleteScene,
  DomainError,
  ensurePlayerToken,
  isRoomModerator,
  projectRoomState,
  renameScene,
  selectScene,
  setSceneUnlocked,
  type PersistedRoomState,
  type RoomActor,
  type RoomRole,
} from './domain';

const INTERNAL_REQUEST_HEADER = 'x-dnd-internal-request';
const MAX_WS_MESSAGE_BYTES = 64 * 1024;
const MAX_COMMANDS_PER_MINUTE = 180;

interface SocketAttachment extends RoomActor {
  version: 1;
  commandWindowStartedAt: number;
  commandCount: number;
  /** New clients opt in after receiving their initial full-state snapshot. */
  supportsPatches?: boolean;
}

interface StateRow {
  [key: string]: string | number | null | ArrayBuffer;
  revision: number;
  data_json: string;
}

interface ReceiptRow {
  [key: string]: string | number | null | ArrayBuffer;
  revision: number;
  result_json: string;
}

/**
 * One instance exists for each `room:<roomId>` name. It is the only process
 * allowed to mutate that room's live board, so a token move is persisted before
 * any WebSocket observer sees it.
 */
export class RoomDurableObject extends DurableObject<Env> {
  private readonly ready: Promise<void>;
  private state: PersistedRoomState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.createSchema();
      this.state = this.loadState();
    });
  }

  async fetch(request: Request): Promise<Response> {
    try {
      return await this.handleRequest(request);
    } catch (error) {
      return this.respondError(error);
    }
  }

  private async handleRequest(request: Request): Promise<Response> {
    await this.ready;
    if (request.headers.get(INTERNAL_REQUEST_HEADER) !== '1') return new Response('Not found', { status: 404 });
    const actor = actorFromHeaders(request.headers);
    const url = new URL(request.url);

    if (url.pathname === '/connect') return this.connectWebSocket(request, actor);
    if (url.pathname === '/initialize' && request.method === 'POST') return this.initialize(request, actor);
    if (url.pathname === '/bootstrap' && request.method === 'GET') return this.respondJson(this.bootstrap(actor));

    if (url.pathname === '/scenes') {
      if (request.method === 'GET') return this.respondJson(this.listScenes(actor));
      if (request.method === 'POST') return this.createSceneRoute(request, actor);
    }
    const sceneMatch = /^\/scenes\/([^/]+)$/u.exec(url.pathname);
    if (sceneMatch) {
      const sceneId = decodeURIComponent(sceneMatch[1]);
      if (request.method === 'GET') return this.getScene(actor, sceneId);
      if (request.method === 'DELETE') return this.deleteSceneRoute(actor, sceneId);
    }
    if (url.pathname === '/campaigns' && request.method === 'GET') {
      return this.respondJson([{ id: activeCampaign(this.requireState()).id, name: activeCampaign(this.requireState()).name }]);
    }
    if (url.pathname === '/campaigns/assign-scene' && request.method === 'POST') return this.assignSceneRoute(request, actor);
    if (url.pathname === '/disconnect-member' && request.method === 'POST') return this.disconnectMemberRoute(request, actor);
    return this.respondJson({ error: { code: 'NOT_FOUND', message: '未知房间操作' } }, 404);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const actor = socketActor(ws);
    if (!actor) {
      ws.close(4003, 'Invalid session');
      return;
    }
    if (typeof message !== 'string' || new TextEncoder().encode(message).byteLength > MAX_WS_MESSAGE_BYTES) {
      ws.close(4009, 'Message too large');
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(message);
    } catch {
      this.sendError(ws, 'INVALID', '消息必须是 JSON');
      return;
    }
    if (!isRecord(data) || typeof data.type !== 'string') {
      this.sendError(ws, 'INVALID', '消息格式无效');
      return;
    }
    if (data.type === 'capabilities') {
      this.setSocketCapabilities(ws, actor, data);
      return;
    }
    if (data.type === 'resync') {
      // Resyncs are read-only, but projecting a large room is still expensive.
      // Charge them to the normal per-socket command budget so a stale/malicious
      // client cannot turn the fallback path into an unbounded clone flood.
      if (!this.consumeCommandBudget(ws, actor)) return;
      this.safeSend(ws, projectRoomState(this.requireState(), actor));
      return;
    }
    if (!this.consumeCommandBudget(ws, actor)) return;
    let commandId: string | undefined;
    try {
      if (data.type === 'op') {
        commandId = clientCommandId(data.id);
        const operations = data.ops;
        if (!Array.isArray(operations) || operations.length === 0 || operations.length > 20) {
          throw new DomainError('INVALID', '一次最多提交 20 个操作');
        }
        let appliedOperations: Op[] = [];
        const result = this.mutate(actor, commandId, 'board.ops', (next) => {
          appliedOperations = [];
          for (const operation of operations) {
            const authorized = authorizeOperation(operation, next, actor);
            applyOperation(next, authorized);
            appliedOperations.push(authorized);
          }
          return { operationCount: appliedOperations.length };
        });
        this.safeSend(ws, { type: 'ack', commandId, revision: result.revision });
        if (result.duplicate) {
          // A reconnect can safely retry the same command ID. Its receipt
          // proves the mutation is durable; give only that client a snapshot
          // so it can drop any local optimistic copy without rebroadcasting.
          this.safeSend(ws, projectRoomState(this.requireState(), actor));
        } else {
          this.broadcastOperations(appliedOperations, result.revision);
        }
        return;
      }
      if (data.type === 'renameScene') {
        this.requireModerator(actor);
        const sceneId = text(data.sceneId, '场景 ID', 180);
        const name = text(data.name, '场景名称');
        const result = this.mutate(actor, clientCommandId(data.id), 'scene.rename', (next) => {
          renameScene(next, sceneId, name);
          return { sceneId };
        });
        this.safeSend(ws, { type: 'ack', revision: result.revision });
        this.broadcastState();
        return;
      }
      if (data.type === 'switchScene') {
        this.requireModerator(actor);
        const sceneId = text(data.sceneId, '场景 ID', 180);
        const result = this.mutate(actor, clientCommandId(data.id), 'scene.select', (next) => {
          selectScene(next, sceneId);
          return { sceneId };
        });
        this.safeSend(ws, { type: 'ack', revision: result.revision });
        this.broadcastState();
        return;
      }
      if (data.type === 'updateSceneUnlock') {
        this.requireModerator(actor);
        if (typeof data.unlocked !== 'boolean') throw new DomainError('INVALID', '解锁状态无效');
        const sceneId = text(data.sceneId, '场景 ID', 180);
        const unlocked = data.unlocked;
        const result = this.mutate(actor, clientCommandId(data.id), 'scene.visibility', (next) => {
          setSceneUnlocked(next, sceneId, unlocked);
          return { sceneId, unlocked };
        });
        this.safeSend(ws, { type: 'ack', revision: result.revision });
        this.broadcastState();
        return;
      }
      this.sendError(ws, 'INVALID', '未知消息类型');
    } catch (error) {
      this.sendDomainError(ws, error, commandId);
    }
  }

  webSocketClose(_ws: WebSocket): void {
    this.broadcastPresence();
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    console.warn(JSON.stringify({ event: 'room_websocket_error', room: this.ctx.id.toString(), message: error instanceof Error ? error.message : String(error) }));
    ws.close(1011, 'Socket error');
  }

  private async initialize(request: Request, actor: RoomActor): Promise<Response> {
    this.requireModerator(actor);
    const body = await objectBody(request);
    const roomName = text(body.roomName, '房间名称');
    const campaignName = text(body.campaignName, '战役名称');
    if (!this.state) {
      const next = createInitialRoomState(roomName, campaignName);
      this.persistInitialState(next);
      this.state = next;
    }
    return this.respondJson({ ok: true, revision: this.requireState().revision });
  }

  private async connectWebSocket(request: Request, actor: RoomActor): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return this.respondJson({ error: { code: 'UPGRADE_REQUIRED', message: '需要 WebSocket 连接' } }, 426);
    }
    if (!this.state) return this.respondJson({ error: { code: 'ROOM_UNINITIALIZED', message: '房间正在初始化' } }, 503);

    // Guests receive a server-created, account-bound starter token. The
    // browser never chooses its controller ID; a future character-claim UI can
    // replace this onboarding record without weakening authorization.
    const needsProvision = actor.role === 'player'
      && !activeScene(this.requireState()).players.some((player) => player.sessionId === actor.userId);
    if (needsProvision) {
      const result = this.mutate(actor, crypto.randomUUID(), 'player.provision', (next) => {
        const provisioned = ensurePlayerToken(next, actor);
        const player = activeScene(next).players.find((candidate) => candidate.sessionId === actor.userId) ?? null;
        return { provisioned, player: player ? structuredClone(player) : null };
      });
      // The joining socket does not exist yet, so this reaches only the room's
      // existing members. They see a newly provisioned player immediately,
      // through the same role-aware patch path as every other board update.
      if (!result.duplicate && result.payload.provisioned && result.payload.player) {
        this.broadcastOperations([{ op: 'addPlayer', player: result.payload.player }], result.revision);
      }
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      version: 1,
      userId: actor.userId,
      memberId: actor.memberId,
      role: actor.role,
      accessEpoch: actor.accessEpoch,
      commandWindowStartedAt: Date.now(),
      commandCount: 0,
    } satisfies SocketAttachment);
    this.safeSend(server, projectRoomState(this.requireState(), actor));
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  private async createSceneRoute(request: Request, actor: RoomActor): Promise<Response> {
    this.requireModerator(actor);
    const body = await objectBody(request);
    const name = text(body.name, '场景名称');
    const result = this.mutate(actor, clientCommandId(body.id), 'scene.create', (next) => {
      const scene = addScene(next, name);
      return { sceneId: scene.id };
    });
    this.broadcastState();
    const sceneId = (result.payload as { sceneId: string }).sceneId;
    return this.respondJson(this.requireState().scenes[sceneId], 201);
  }

  private deleteSceneRoute(actor: RoomActor, sceneId: string): Response {
    this.requireModerator(actor);
    const result = this.mutate(actor, crypto.randomUUID(), 'scene.delete', (next) => {
      if (!deleteScene(next, sceneId)) throw new DomainError('INVALID', '至少需要保留一个场景');
      return { sceneId };
    });
    this.broadcastState();
    return this.respondJson({ ok: true, revision: result.revision });
  }

  private async assignSceneRoute(request: Request, actor: RoomActor): Promise<Response> {
    this.requireModerator(actor);
    const body = await objectBody(request);
    const sceneId = text(body.sceneId, '场景 ID', 180);
    const campaignId = text(body.campaignId, '战役 ID', 180);
    const state = this.requireState();
    if (campaignId !== state.currentCampaignId) return this.respondJson({ ok: false, message: '房间固定绑定一个战役' }, 409);
    const result = this.mutate(actor, clientCommandId(body.id), 'scene.assign', (next) => {
      if (!next.scenes[sceneId]) throw new DomainError('NOT_FOUND', '找不到场景');
      const campaign = activeCampaign(next);
      if (!campaign.sceneIds.includes(sceneId)) campaign.sceneIds.push(sceneId);
      return { sceneId };
    });
    this.broadcastState();
    return this.respondJson({ ok: true, revision: result.revision });
  }

  private getScene(actor: RoomActor, sceneId: string): Response {
    const scene = this.requireState().scenes[sceneId];
    if (!scene || (!isRoomModerator(actor.role) && !scene.unlocked)) return this.respondJson({ error: { code: 'NOT_FOUND', message: '找不到场景' } }, 404);
    const copy = structuredClone(scene);
    if (!isRoomModerator(actor.role)) {
      copy.players = copy.players.map((player) => ({ ...player, sessionId: player.sessionId === actor.userId ? actor.userId : null }));
      copy.initiative = copy.initiative.map((entry) => ({ ...entry, sessionId: entry.sessionId === actor.userId ? actor.userId : null }));
    }
    return this.respondJson(copy);
  }

  private listScenes(actor: RoomActor): Array<{ id: string; name: string; unlocked: boolean }> {
    const campaign = activeCampaign(this.requireState());
    return campaign.sceneIds.flatMap((id) => {
      const scene = this.requireState().scenes[id];
      if (!scene || (!isRoomModerator(actor.role) && !scene.unlocked)) return [];
      return [{ id: scene.id, name: scene.name, unlocked: Boolean(scene.unlocked) }];
    });
  }

  private async disconnectMemberRoute(request: Request, actor: RoomActor): Promise<Response> {
    this.requireModerator(actor);
    const body = await objectBody(request);
    const memberId = text(body.memberId, '成员 ID', 180);
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socketActor(socket);
      if (attachment?.memberId === memberId) socket.close(4003, 'Membership revoked');
    }
    return this.respondJson({ ok: true });
  }

  private bootstrap(actor: RoomActor): { room: { id: string }; state: ReturnType<typeof projectRoomState>; membership: { role: RoomRole; canManage: boolean } } {
    return {
      room: { id: this.ctx.id.toString() },
      state: projectRoomState(this.requireState(), actor),
      membership: { role: actor.role, canManage: isRoomModerator(actor.role) },
    };
  }

  private mutate<T>(actor: RoomActor, commandId: string, action: string, update: (next: PersistedRoomState) => T): { revision: number; payload: T; duplicate: boolean } {
    const prior = this.ctx.storage.sql.exec<ReceiptRow>(
      'SELECT revision, result_json FROM room_command_receipts WHERE actor_member_id = ?1 AND command_id = ?2',
      actor.memberId,
      commandId,
    ).toArray()[0];
    if (prior) {
      return { revision: prior.revision, payload: JSON.parse(prior.result_json) as T, duplicate: true };
    }

    const current = this.requireState();
    const next = structuredClone(current);
    const payload = update(next);
    next.revision = current.revision + 1;
    const now = Date.now();
    const event = { action, actorMemberId: actor.memberId, revision: next.revision, occurredAt: now };
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO room_state (singleton, revision, data_json, updated_at)
         VALUES (1, ?1, ?2, ?3)
         ON CONFLICT(singleton) DO UPDATE SET revision = excluded.revision, data_json = excluded.data_json, updated_at = excluded.updated_at`,
        next.revision,
        JSON.stringify(next),
        now,
      );
      this.ctx.storage.sql.exec(
        'INSERT INTO room_events (actor_member_id, command_id, action, payload_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
        actor.memberId,
        commandId,
        action,
        JSON.stringify(event),
        now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO room_command_receipts (actor_member_id, command_id, revision, result_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
        actor.memberId,
        commandId,
        next.revision,
        JSON.stringify(payload),
        now,
      );
    });
    this.state = next;
    return { revision: next.revision, payload, duplicate: false };
  }

  private persistInitialState(state: PersistedRoomState): void {
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        'INSERT INTO room_state (singleton, revision, data_json, updated_at) VALUES (1, ?1, ?2, ?3)',
        state.revision,
        JSON.stringify(state),
        now,
      );
      this.ctx.storage.sql.exec(
        'INSERT INTO room_events (actor_member_id, command_id, action, payload_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
        'system',
        'room.initialize',
        'room.initialize',
        JSON.stringify({ revision: state.revision, occurredAt: now }),
        now,
      );
    });
  }

  private createSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        revision INTEGER NOT NULL,
        data_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_member_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        action TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (actor_member_id, command_id)
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_command_receipts (
        actor_member_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (actor_member_id, command_id)
      )
    `);
  }

  private loadState(): PersistedRoomState | null {
    const row = this.ctx.storage.sql.exec<StateRow>('SELECT revision, data_json FROM room_state WHERE singleton = 1').toArray()[0];
    if (!row) return null;
    const state = JSON.parse(row.data_json) as PersistedRoomState;
    if (state.schemaVersion !== 1 || typeof state.revision !== 'number') throw new Error('Unsupported room state');
    return state;
  }

  private requireState(): PersistedRoomState {
    if (!this.state) throw new DomainError('CORRUPT_STATE', '房间尚未初始化');
    return this.state;
  }

  private requireModerator(actor: RoomActor): void {
    if (!isRoomModerator(actor.role)) throw new DomainError('FORBIDDEN', '没有此操作权限');
  }

  private broadcastState(): void {
    for (const socket of this.ctx.getWebSockets()) {
      const actor = socketActor(socket);
      if (actor) this.safeSend(socket, projectRoomState(this.requireState(), actor));
    }
    this.broadcastPresence();
  }

  /**
   * Existing tabs keep receiving projected snapshots.  Newer tabs explicitly
   * opt into small, already-authorized operation patches after their initial
   * snapshot, avoiding a full scene clone/JSON round-trip for edits such as a
   * name, avatar URL, map calibration, or token position.
   */
  private broadcastOperations(operations: Op[], revision: number): void {
    const state = this.requireState();
    for (const socket of this.ctx.getWebSockets()) {
      const actor = socketActor(socket);
      if (!actor) continue;
      const patch = actor.supportsPatches ? projectPatchOperations(state, operations, actor) : null;
      if (patch) {
        this.safeSend(socket, { type: 'patch', revision, ops: patch });
      } else {
        this.safeSend(socket, projectRoomState(state, actor));
      }
    }
    // Presence only changes on socket open/close. Sending it after every board
    // operation created needless extra frames beside the former full snapshot.
  }

  private setSocketCapabilities(socket: WebSocket, actor: SocketAttachment, data: Record<string, unknown>): void {
    if (data.patches !== 1) {
      this.sendError(socket, 'INVALID', '客户端能力声明无效');
      return;
    }
    socket.serializeAttachment({ ...actor, supportsPatches: true } satisfies SocketAttachment);
  }

  private broadcastPresence(): void {
    const online = this.ctx.getWebSockets().reduce((count, socket) => {
      const actor = socketActor(socket);
      return count + (actor?.role === 'player' ? 1 : 0);
    }, 0);
    for (const socket of this.ctx.getWebSockets()) this.safeSend(socket, { type: 'meta', online });
  }

  private consumeCommandBudget(socket: WebSocket, actor: SocketAttachment): boolean {
    const now = Date.now();
    const attachment = { ...actor };
    if (now - attachment.commandWindowStartedAt >= 60_000) {
      attachment.commandWindowStartedAt = now;
      attachment.commandCount = 0;
    }
    attachment.commandCount += 1;
    socket.serializeAttachment(attachment);
    if (attachment.commandCount <= MAX_COMMANDS_PER_MINUTE) return true;
    socket.close(4008, 'Rate limit exceeded');
    return false;
  }

  private respondJson(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  private respondError(error: unknown): Response {
    if (error instanceof DomainError) {
      const status = error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID' ? 400 : 500;
      return this.respondJson({ error: { code: error.code, message: error.message } }, status);
    }
    console.error(JSON.stringify({ event: 'room_request_failed', room: this.ctx.id.toString(), message: error instanceof Error ? error.message : String(error) }));
    return this.respondJson({ error: { code: 'INTERNAL', message: '房间服务暂时不可用' } }, 500);
  }

  private safeSend(socket: WebSocket, data: unknown): void {
    try {
      socket.send(JSON.stringify(data));
    } catch {
      // A socket may close between getWebSockets() and send(). The hibernation
      // runtime will deliver its close event; there is nothing to retry here.
    }
  }

  private sendDomainError(socket: WebSocket, error: unknown, commandId?: string): void {
    if (error instanceof DomainError) {
      this.sendError(socket, error.code, error.message, commandId);
      return;
    }
    console.error(JSON.stringify({ event: 'room_command_failed', room: this.ctx.id.toString(), message: error instanceof Error ? error.message : String(error) }));
    this.sendError(socket, 'INTERNAL', '命令处理失败', commandId);
  }

  private sendError(socket: WebSocket, code: string, message: string, commandId?: string): void {
    this.safeSend(socket, { type: 'error', code, message, ...(commandId ? { commandId } : {}) });
  }
}

/**
 * Turn a server-authorized operation into the smallest operation a particular
 * viewer may apply.  Returning null deliberately falls back to the existing
 * full projection for commands whose result contains generated IDs or a scene
 * switch.  This keeps patching a performance optimization, never a new trust
 * boundary.
 */
export function projectPatchOperations(state: PersistedRoomState, operations: Op[], actor: RoomActor): Op[] | null {
  const scene = activeScene(state);
  const canManage = isRoomModerator(actor.role);
  const projected: Op[] = [];
  for (const operation of operations) {
    switch (operation.op) {
      case 'moveToken':
      case 'removeToken':
      case 'updateToken':
      case 'removePlayer':
      case 'addWall':
      case 'removeWall':
      case 'updateGrid':
      case 'updateMap':
      case 'updateMapScale':
      case 'addFavorite':
      case 'removeFavorite':
      case 'setFog':
      case 'revealAllFog':
      case 'coverAllFog':
        projected.push(structuredClone(operation));
        break;
      case 'addToken': {
        // Monster numbering is assigned by applyOperation, so use the durable
        // record rather than the browser's pre-authorization payload.
        const token = scene.tokens.find((candidate) => candidate.id === operation.token.id);
        if (!token) return null;
        projected.push({ op: 'addToken', token: structuredClone(token) });
        break;
      }
      case 'addPlayer': {
        const player = scene.players.find((candidate) => candidate.id === operation.player.id);
        if (!player) return null;
        projected.push({ op: 'addPlayer', player: projectPlayerToken(player, actor, canManage) });
        break;
      }
      case 'updatePlayer': {
        const player = scene.players.find((candidate) => candidate.id === operation.tokenId);
        if (!player) return null;
        const patch = structuredClone(operation.patch);
        if ('sessionId' in patch) {
          patch.sessionId = canManage || player.sessionId === actor.userId ? player.sessionId : null;
        }
        projected.push({ op: 'updatePlayer', tokenId: operation.tokenId, patch });
        break;
      }
      case 'addEnemy':
      case 'removeEnemy':
        // Player projections intentionally omit the DM's encounter library.
        if (canManage) projected.push(structuredClone(operation));
        break;
      // Initiative additions can get a server-created ID; scene/campaign
      // switching changes more than one projection field. Retain snapshots
      // for those infrequent operations rather than inventing a lossy patch.
      case 'switchCampaign':
      case 'submitInitiative':
      case 'addToInitiative':
        return null;
      case 'removeFromInitiative':
      case 'advanceTurn':
      case 'reorderInitiative':
        projected.push(structuredClone(operation));
        break;
    }
  }
  return projected;
}

function projectPlayerToken(player: PlayerToken, actor: RoomActor, canManage: boolean): PlayerToken {
  return {
    ...structuredClone(player),
    sessionId: canManage || player.sessionId === actor.userId ? player.sessionId : null,
  };
}

function actorFromHeaders(headers: Headers): RoomActor {
  const userId = headers.get('x-dnd-user-id');
  const memberId = headers.get('x-dnd-member-id');
  const role = headers.get('x-dnd-room-role');
  const accessEpoch = Number(headers.get('x-dnd-access-epoch'));
  if (!userId || !memberId || !isRoomRole(role) || !Number.isInteger(accessEpoch) || accessEpoch < 1) {
    throw new DomainError('FORBIDDEN', '无效的房间身份');
  }
  return { userId, memberId, role, accessEpoch };
}

function socketActor(socket: WebSocket): SocketAttachment | null {
  const value: unknown = socket.deserializeAttachment();
  if (!isRecord(value) || value.version !== 1 || typeof value.userId !== 'string' || typeof value.memberId !== 'string' || !isRoomRole(value.role)
    || typeof value.accessEpoch !== 'number' || typeof value.commandWindowStartedAt !== 'number' || typeof value.commandCount !== 'number') return null;
  return value as unknown as SocketAttachment;
}

function isRoomRole(value: unknown): value is RoomRole {
  return value === 'host' || value === 'dm' || value === 'assistant_dm' || value === 'player' || value === 'spectator';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function objectBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new DomainError('INVALID', '请求必须是 JSON 对象');
  }
  if (!isRecord(value)) throw new DomainError('INVALID', '请求必须是 JSON 对象');
  return value;
}

function text(value: unknown, label: string, maximumLength = 120): string {
  if (typeof value !== 'string') throw new DomainError('INVALID', `${label}无效`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) throw new DomainError('INVALID', `${label}长度无效`);
  return normalized;
}

function clientCommandId(value: unknown): string {
  if (typeof value === 'string' && value.length > 0 && value.length <= 180) return value;
  return crypto.randomUUID();
}

// Keep imported shared types present in generated declaration output. They are
// used structurally by the persistent state but this explicit reference makes
// the room-state boundary easy to locate in IDE navigation.
void ({} as Campaign | Scene);
