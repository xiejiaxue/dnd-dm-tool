import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_TOKEN_SIZE, type Op } from '../../shared/types';
import {
  activeCampaign,
  activeScene,
  addScene,
  applyOperation,
  createInitialRoomState,
  createSceneFolder,
  deleteSceneFolder,
  deleteScene,
  DomainError,
  ensurePlayerToken,
  isRoomModerator,
  normalizeLegacyPlayerTokenSizes,
  moveSceneToFolder,
  projectRoomState,
  renameScene,
  renameSceneFolder,
  selectScene,
  setSceneUnlocked,
  type PersistedRoomState,
  type RoomActor,
  type RoomRole,
} from './domain';
import { authorizeOperation } from './board/operation-authorization';
import { projectPatchOperations } from './board/patch-projection';
import {
  createRoomSchema,
  findCommandReceipt,
  loadRoomState,
  writeInitialRoomState,
  writeNormalizedRoomState,
  writeRoomMutation,
} from './board/persistence';
import { normalizePersistedRoomState } from './board/state-normalization';
import {
  actorFromHeaders,
  clientCommandId,
  INTERNAL_REQUEST_HEADER,
  isRecord,
  MAX_COMMANDS_PER_MINUTE,
  MAX_WS_MESSAGE_BYTES,
  objectBody,
  socketActor,
  text,
  type SocketAttachment,
} from './board/protocol';
import { instantiateRoomTemplate, loadRoomTemplate } from './room-templates';

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
      createRoomSchema(this.ctx.storage.sql);
      this.state = loadRoomState(this.ctx.storage.sql);
      if (this.state && normalizePersistedRoomState(this.state)) {
        this.ctx.storage.transactionSync(() => writeNormalizedRoomState(this.ctx.storage.sql, this.state!, Date.now()));
      }
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
    if (url.pathname === '/destroy' && request.method === 'DELETE') return this.destroy(actor);
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
    if (url.pathname === '/ops' && request.method === 'POST') return this.applyOperationsRoute(request, actor);
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
        const { result, appliedOperations } = this.applyOperations(actor, commandId, data.ops);
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
      if (data.type === 'createSceneFolder') {
        this.requireModerator(actor);
        const name = text(data.name, '文件夹名称', 80);
        const result = this.mutate(actor, clientCommandId(data.id), 'scene-folder.create', (next) => ({
          folder: createSceneFolder(next, name),
        }));
        this.safeSend(ws, { type: 'ack', revision: result.revision });
        this.broadcastState();
        return;
      }
      if (data.type === 'renameSceneFolder') {
        this.requireModerator(actor);
        const folderId = text(data.folderId, '文件夹 ID', 180);
        const name = text(data.name, '文件夹名称', 80);
        const result = this.mutate(actor, clientCommandId(data.id), 'scene-folder.rename', (next) => {
          renameSceneFolder(next, folderId, name);
          return { folderId, name };
        });
        this.safeSend(ws, { type: 'ack', revision: result.revision });
        this.broadcastState();
        return;
      }
      if (data.type === 'deleteSceneFolder') {
        this.requireModerator(actor);
        const folderId = text(data.folderId, '文件夹 ID', 180);
        const result = this.mutate(actor, clientCommandId(data.id), 'scene-folder.delete', (next) => {
          deleteSceneFolder(next, folderId);
          return { folderId };
        });
        this.safeSend(ws, { type: 'ack', revision: result.revision });
        this.broadcastState();
        return;
      }
      if (data.type === 'moveSceneToFolder') {
        this.requireModerator(actor);
        const sceneId = text(data.sceneId, '场景 ID', 180);
        const folderId = data.folderId === null ? null : text(data.folderId, '文件夹 ID', 180);
        const result = this.mutate(actor, clientCommandId(data.id), 'scene-folder.move', (next) => {
          moveSceneToFolder(next, sceneId, folderId);
          return { sceneId, folderId };
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
      const templateId = typeof body.templateId === 'string' ? text(body.templateId, '模板 ID', 64) : null;
      const roomSlug = typeof body.roomSlug === 'string' ? text(body.roomSlug, '房间编号', 180) : '';
      const next = templateId
        ? instantiateRoomTemplate(roomName, campaignName, roomSlug, await loadRoomTemplate(this.env, templateId))
        : createInitialRoomState(roomName, campaignName);
      normalizePersistedRoomState(next);
      const now = Date.now();
      this.ctx.storage.transactionSync(() => writeInitialRoomState(this.ctx.storage.sql, next, now));
      this.state = next;
    }
    return this.respondJson({ ok: true, revision: this.requireState().revision });
  }

  private async destroy(actor: RoomActor): Promise<Response> {
    if (actor.role !== 'host') throw new DomainError('FORBIDDEN', '只有房主可以删除房间');
    for (const socket of this.ctx.getWebSockets()) socket.close(4004, 'Room deleted');
    this.state = null;
    await this.ctx.storage.deleteAll();
    return this.respondJson({ ok: true });
  }

  private async applyOperationsRoute(request: Request, actor: RoomActor): Promise<Response> {
    const body = await objectBody(request);
    const commandId = clientCommandId(body.id);
    const { result, appliedOperations } = this.applyOperations(actor, commandId, body.ops);
    if (!result.duplicate) this.broadcastOperations(appliedOperations, result.revision);
    return this.respondJson({ ok: true, revision: result.revision });
  }

  private applyOperations(actor: RoomActor, commandId: string, operations: unknown): {
    result: { revision: number; payload: { operationCount: number }; duplicate: boolean };
    appliedOperations: Op[];
  } {
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
    return { result, appliedOperations };
  }

  private async connectWebSocket(request: Request, actor: RoomActor): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return this.respondJson({ error: { code: 'UPGRADE_REQUIRED', message: '需要 WebSocket 连接' } }, 426);
    }
    if (!this.state) return this.respondJson({ error: { code: 'ROOM_UNINITIALIZED', message: '房间正在初始化' } }, 503);

    // Guests receive a server-created, account-bound starter token. The
    // browser never chooses its controller ID; a future character-claim UI can
    // replace this onboarding record without weakening authorization.
    const currentScene = activeScene(this.requireState());
    const currentPlayer = currentScene.players.find((player) => player.sessionId === actor.userId);
    const needsProvision = actor.role === 'player'
      && !currentPlayer;
    const needsTokenSizeMigration = Object.values(this.requireState().scenes)
      .some((scene) => scene.players.some((player) => player.size !== DEFAULT_TOKEN_SIZE));
    if (needsProvision || needsTokenSizeMigration) {
      const result = this.mutate(actor, crypto.randomUUID(), 'player.provision', (next) => {
        const resizedPlayers = normalizeLegacyPlayerTokenSizes(next);
        const provisioned = ensurePlayerToken(next, actor);
        const player = provisioned
          ? activeScene(next).players.find((candidate) => candidate.sessionId === actor.userId) ?? null
          : null;
        return { provisioned, player: player ? structuredClone(player) : null, resizedPlayers };
      });
      // The joining socket does not exist yet, so this reaches only the room's
      // existing members. They see both one-time size migrations and newly
      // provisioned players through the same role-aware patch path as normal
      // board updates.
      if (!result.duplicate) {
        const operations: Op[] = result.payload.resizedPlayers.map((player) => ({
          op: 'updatePlayer', tokenId: player.id, patch: { size: DEFAULT_TOKEN_SIZE },
        }));
        if (result.payload.provisioned && result.payload.player) {
          operations.push({ op: 'addPlayer', player: result.payload.player });
        }
        // A migration in a non-active scene has no safe small patch for the
        // current board. Send a snapshot so existing sockets still advance to
        // the persisted revision instead of detecting a later revision gap.
        if (operations.length > 0) this.broadcastOperations(operations, result.revision);
        else this.broadcastState();
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

  private listScenes(actor: RoomActor): Array<{ id: string; name: string; unlocked: boolean; mapImage: string | null; folderId: string | null }> {
    const campaign = activeCampaign(this.requireState());
    return campaign.sceneIds.flatMap((id) => {
      const scene = this.requireState().scenes[id];
      if (!scene || (!isRoomModerator(actor.role) && !scene.unlocked)) return [];
      return [{
        id: scene.id,
        name: scene.name,
        unlocked: Boolean(scene.unlocked),
        mapImage: scene.mapImage,
        folderId: campaign.sceneFolderAssignments?.[scene.id] ?? null,
      }];
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
    const prior = findCommandReceipt(this.ctx.storage.sql, actor.memberId, commandId);
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
      writeRoomMutation(this.ctx.storage.sql, {
        state: next,
        actorMemberId: actor.memberId,
        commandId,
        action,
        event,
        result: payload,
        now,
      });
    });
    this.state = next;
    return { revision: next.revision, payload, duplicate: false };
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
