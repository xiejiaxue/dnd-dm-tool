import { findModuleRoute } from './modules/registry';
import type { ModuleRoute } from './modules/types';
import { resolveFogBasisScale } from '../../shared/fog';
import { DurableObject } from "cloudflare:workers";
import { CampaignStore } from "./campaign-store";
import type { Campaign, Op, PlayerToken, Scene } from "../../shared/types";
import type { ChatMessage } from "../../shared/types";
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
} from "./domain";

const INTERNAL_REQUEST_HEADER = "x-dnd-internal-request";
const MAX_WS_MESSAGE_BYTES = 64 * 1024;
const MAX_COMMANDS_PER_MINUTE = 180;

interface SocketAttachment extends RoomActor {
  version: 1;
  commandWindowStartedAt: number;
  commandCount: number;
  /** New clients opt in after receiving their initial full-state snapshot. */
  supportsPatches?: boolean;
}

interface ReceiptRow {
  [key: string]: string | number | null | ArrayBuffer;
  revision: number;
  result_json: string;
}

/**
 * One instance exists for each `campaign:<campaignId>` name. It is the only process
 * allowed to mutate that room's live board, so a token move is persisted before
 * any WebSocket observer sees it.
 */
export class RoomDurableObject extends DurableObject<Env> {
  private readonly ready: Promise<void>;
  private state: PersistedRoomState | null = null;
  private store!: CampaignStore;
  private enabled = true;
  private access = new Map<
    string,
    { userId: string; epoch: number; role: string; active: boolean }
  >();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.store = new CampaignStore(this.ctx.storage);
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS actor_access(member_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,epoch INTEGER NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL)",
      );
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS campaign_flags(singleton INTEGER PRIMARY KEY,enabled INTEGER NOT NULL)",
      );
      this.enabled =
        this.ctx.storage.sql
          .exec<{
            enabled: number;
          }>("SELECT enabled FROM campaign_flags WHERE singleton=1")
          .toArray()[0]?.enabled !== 0;
      for (const row of this.ctx.storage.sql
        .exec<{
          member_id: string;
          user_id: string;
          epoch: number;
          role: string;
          active: number;
        }>("SELECT * FROM actor_access")
        .toArray())
        this.access.set(row.member_id, {
          userId: row.user_id,
          epoch: row.epoch,
          role: row.role,
          active: Boolean(row.active),
        });
      this.state = this.store.load();
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
    if (request.headers.get(INTERNAL_REQUEST_HEADER) !== "1")
      return new Response("Not found", { status: 404 });
    const actor = actorFromHeaders(request.headers);
    const url = new URL(request.url);

    if (url.pathname === "/refresh-access" && request.method === "POST")
      return this.refreshAccess(actor.campaignId!);
    if (url.pathname !== "/initialize") {
      this.registerActor(actor);
      this.requireActor(actor);
    }
    if (url.pathname === "/connect")
      return this.connectWebSocket(request, actor);
    if (url.pathname === "/initialize" && request.method === "POST")
      return this.initialize(request, actor);
    if (url.pathname === "/bootstrap" && request.method === "GET")
      return this.respondJson(this.bootstrap(actor));

    const moduleMatch = /^\/([a-z0-9-]+)(?:\/([^/]+))?$/u.exec(url.pathname);
    const moduleRoute = moduleMatch && findModuleRoute(moduleMatch[1], moduleMatch[2] !== undefined, request.method);
    if (moduleRoute) return this.moduleRoute(moduleRoute, request, actor, moduleMatch[2]);
    if (url.pathname === "/scenes") {
      if (request.method === "GET")
        return this.respondJson(this.listScenes(actor));
      if (request.method === "POST")
        return this.createSceneRoute(request, actor);
    }
    const sceneMatch = /^\/scenes\/([^/]+)$/u.exec(url.pathname);
    if (sceneMatch) {
      const sceneId = decodeURIComponent(sceneMatch[1]);
      if (request.method === "GET") return this.getScene(actor, sceneId);
      if (request.method === "DELETE")
        return this.deleteSceneRoute(actor, sceneId);
    }
    if (url.pathname === "/characters/provision" && request.method === "POST")
      return this.provisionCharacterRoute(actor);
    return this.respondJson(
      { error: { code: "NOT_FOUND", message: "未知房间操作" } },
      404,
    );
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    await this.ready;
    const actor = socketActor(ws);
    if (!actor) {
      ws.close(4003, "Invalid session");
      return;
    }
    try {
      this.requireActor(actor);
    } catch {
      ws.close(4003, "Membership revoked");
      return;
    }
    if (
      typeof message !== "string" ||
      new TextEncoder().encode(message).byteLength > MAX_WS_MESSAGE_BYTES
    ) {
      ws.close(4009, "Message too large");
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(message);
    } catch {
      this.sendError(ws, "INVALID", "消息必须是 JSON");
      return;
    }
    if (!isRecord(data) || typeof data.type !== "string") {
      this.sendError(ws, "INVALID", "消息格式无效");
      return;
    }
    if (data.type === "capabilities") {
      this.setSocketCapabilities(ws, actor, data);
      return;
    }
    if (data.type === "resync") {
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
      if (data.type === "op") {
        commandId = clientCommandId(data.id);
        const operations = data.ops;
        if (
          !Array.isArray(operations) ||
          operations.length === 0 ||
          operations.length > 20
        ) {
          throw new DomainError("INVALID", "一次最多提交 20 个操作");
        }
        let appliedOperations: Op[] = [];
        const result = this.mutate(
          actor,
          commandId,
          "board.ops",
          (next) => {
            appliedOperations = [];
            for (const operation of operations) {
              const authorized = authorizeOperation(operation, next, actor);
              applyOperation(next, authorized);
              appliedOperations.push(authorized);
            }
            return { operationCount: appliedOperations.length };
          },
          undefined,
          operations.some(
            (op) =>
              isRecord(op) &&
              ["addEnemy", "removeEnemy"].includes(String(op.op)),
          ),
        );
        this.safeSend(ws, {
          type: "ack",
          commandId,
          revision: result.revision,
        });
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
      if (data.type === "chat") {
        const textValue = text(data.text, "消息", 1_000);
        const visibility =
          data.visibility === "gm" || data.visibility === "self"
            ? data.visibility
            : "public";
        const result = this.mutate(
          actor,
          clientCommandId(data.id),
          "chat.create",
          (next) => {
            const message = createChatMessage(
              next.campaign.id,
              actor,
              textValue,
              visibility,
            );
            next.messages = [...(next.messages ?? []), message].slice(-500);
            return { messageId: message.id };
          },
          [],
        );
        this.safeSend(ws, { type: "ack", revision: result.revision });
        this.broadcastState();
        return;
      }
      if (data.type === "renameScene") {
        this.requireModerator(actor);
        const sceneId = text(data.sceneId, "场景 ID", 180);
        const name = text(data.name, "场景名称");
        const result = this.mutate(
          actor,
          clientCommandId(data.id),
          "scene.rename",
          (next) => {
            renameScene(next, sceneId, name);
            return { sceneId };
          },
          [sceneId],
        );
        this.safeSend(ws, { type: "ack", revision: result.revision });
        this.broadcastState();
        return;
      }
      if (data.type === "switchScene") {
        this.requireModerator(actor);
        const sceneId = text(data.sceneId, "场景 ID", 180);
        const result = this.mutate(
          actor,
          clientCommandId(data.id),
          "scene.select",
          (next) => {
            selectScene(next, sceneId);
            this.ensureConnectedPlayers(next);
            return { sceneId };
          },
          [],
        );
        this.safeSend(ws, { type: "ack", revision: result.revision });
        this.broadcastState();
        return;
      }
      if (data.type === "updateSceneUnlock") {
        this.requireModerator(actor);
        if (typeof data.unlocked !== "boolean")
          throw new DomainError("INVALID", "解锁状态无效");
        const sceneId = text(data.sceneId, "场景 ID", 180);
        const unlocked = data.unlocked;
        const result = this.mutate(
          actor,
          clientCommandId(data.id),
          "scene.visibility",
          (next) => {
            setSceneUnlocked(next, sceneId, unlocked);
            return { sceneId, unlocked };
          },
          [sceneId],
        );
        this.safeSend(ws, { type: "ack", revision: result.revision });
        this.broadcastState();
        return;
      }
      this.sendError(ws, "INVALID", "未知消息类型");
    } catch (error) {
      this.sendDomainError(ws, error, commandId);
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    ws.close(code === 1005 ? 1000 : code);
    this.broadcastPresence();
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    console.warn(
      JSON.stringify({
        event: "room_websocket_error",
        room: this.ctx.id.toString(),
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    ws.close(1011, "Socket error");
  }

  private async initialize(
    request: Request,
    actor: RoomActor,
  ): Promise<Response> {
    const body = await objectBody(request);
    const campaignId = text(body.campaignId, "战役 ID", 180);
    if (
      actor.campaignId !== campaignId ||
      !this.ctx.id.equals(this.env.ROOMS.idFromName(`campaign:${campaignId}`))
    )
      throw new DomainError("FORBIDDEN", "战役身份不匹配");
    if (this.state && this.state.campaign.id !== campaignId)
      throw new DomainError("FORBIDDEN", "禁止切换实时实例所属战役");
    this.registerActor(actor);
    if (!this.state) {
      const name = text(body.campaignName, "战役名称");
      const next = createInitialRoomState(
        name,
        name,
        campaignId,
        typeof body.firstSceneName === "string"
          ? body.firstSceneName
          : undefined,
      );
      // This endpoint accepts authenticated internal requests only. Templates are
      // prepared by the repository and are applied only to an uninitialized room.
      if (Array.isArray(body.scenes) && body.scenes.length) {
        const scenes = body.scenes as Scene[];
        next.scenes = Object.fromEntries(scenes.map(scene => [scene.id, scene]));
        next.campaign.sceneIds = scenes.map(scene => scene.id);
        next.currentSceneId = scenes[0].id;
      }
      this.ctx.storage.transactionSync(() => this.store.save(next));
      this.state = next;
    }
    return this.respondJson({ ok: true, revision: this.state.revision });
  }

  private registerActor(actor: RoomActor): void {
    if (this.state && actor.campaignId !== this.state.campaign.id)
      throw new DomainError("FORBIDDEN", "战役身份不匹配");
    const old = this.access.get(actor.memberId);
    if (
      old &&
      (old.userId !== actor.userId ||
        old.epoch > actor.accessEpoch ||
        (old.epoch === actor.accessEpoch && !old.active))
    )
      throw new DomainError("FORBIDDEN", "成员资格已变更");
    this.enabled = true;
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO campaign_flags(singleton,enabled) VALUES(1,1)",
    );
    this.access.set(actor.memberId, {
      userId: actor.userId,
      epoch: actor.accessEpoch,
      role: actor.role,
      active: true,
    });
    this.ctx.storage.sql.exec(
      "INSERT INTO actor_access(member_id,user_id,epoch,role,active) VALUES(?1,?2,?3,?4,1) ON CONFLICT(member_id) DO UPDATE SET epoch=excluded.epoch,role=excluded.role,active=1",
      actor.memberId,
      actor.userId,
      actor.accessEpoch,
      actor.role,
    );
  }
  private requireActor(actor: RoomActor): void {
    const access = this.access.get(actor.memberId);
    if (
      !this.enabled ||
      !access?.active ||
      access.userId !== actor.userId ||
      access.epoch !== actor.accessEpoch ||
      access.role !== actor.role ||
      actor.campaignId !== this.state?.campaign.id
    )
      throw new DomainError("FORBIDDEN", "战役访问权限已变更");
  }
  private async refreshAccess(campaignId: string): Promise<Response> {
    if (campaignId !== this.state?.campaign.id)
      throw new DomainError("FORBIDDEN", "战役身份不匹配");
    const campaign = await this.env.DB.prepare(
      "SELECT status,deleted_at FROM campaigns WHERE id=?1",
    )
      .bind(campaignId)
      .first<{ status: string; deleted_at: number | null }>();
    const members = await this.env.DB.prepare(
      "SELECT id,user_id,role,status,permission_epoch FROM campaign_members WHERE campaign_id=?1",
    )
      .bind(campaignId)
      .all<{
        id: string;
        user_id: string;
        role: string;
        status: string;
        permission_epoch: number;
      }>();
    this.ctx.storage.transactionSync(() => {
      this.enabled = campaign?.status === "active" && !campaign.deleted_at;
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO campaign_flags(singleton,enabled) VALUES(1,?1)",
        this.enabled ? 1 : 0,
      );
      for (const member of members.results) {
        const role = member.role === "owner" ? "host" : member.role;
        this.access.set(member.id, {
          userId: member.user_id,
          epoch: member.permission_epoch,
          role,
          active: member.status === "active",
        });
        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO actor_access(member_id,user_id,epoch,role,active) VALUES(?1,?2,?3,?4,?5)",
          member.id,
          member.user_id,
          member.permission_epoch,
          role,
          member.status === "active" ? 1 : 0,
        );
      }
    });
    for (const socket of this.ctx.getWebSockets()) {
      const member = socketActor(socket);
      try {
        if (!member) throw new Error();
        this.requireActor(member);
      } catch {
        socket.close(4003, "Membership revoked");
      }
    }
    return this.respondJson({ ok: true });
  }

  private async connectWebSocket(
    request: Request,
    actor: RoomActor,
  ): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return this.respondJson(
        { error: { code: "UPGRADE_REQUIRED", message: "需要 WebSocket 连接" } },
        426,
      );
    }
    if (actor.role === "player" && !actor.characterId)
      throw new DomainError("FORBIDDEN", "请先选择战役角色");
    if (!this.state)
      return this.respondJson(
        { error: { code: "ROOM_UNINITIALIZED", message: "房间正在初始化" } },
        503,
      );

    // Guests receive a server-created, account-bound starter token. The
    // browser never chooses its controller ID; a future character-claim UI can
    // replace this onboarding record without weakening authorization.
    const needsProvision =
      actor.role === "player" &&
      !activeScene(this.requireState()).players.some(
        (player) => player.sessionId === actor.userId,
      );
    if (needsProvision) {
      const result = this.mutate(
        actor,
        crypto.randomUUID(),
        "player.provision",
        (next) => {
          const provisioned = ensurePlayerToken(next, actor);
          const player =
            activeScene(next).players.find(
              (candidate) => candidate.sessionId === actor.userId,
            ) ?? null;
          return {
            provisioned,
            player: player ? structuredClone(player) : null,
          };
        },
      );
      // The joining socket does not exist yet, so this reaches only the room's
      // existing members. They see a newly provisioned player immediately,
      // through the same role-aware patch path as every other board update.
      if (
        !result.duplicate &&
        result.payload.provisioned &&
        result.payload.player
      ) {
        this.broadcastOperations(
          [{ op: "addPlayer", player: result.payload.player }],
          result.revision,
        );
      }
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      version: 1,
      campaignId: actor.campaignId,
      userId: actor.userId,
      memberId: actor.memberId,
      role: actor.role,
      accessEpoch: actor.accessEpoch,
      ...(actor.displayName ? { displayName: actor.displayName } : {}),
      ...(actor.characterId ? { characterId: actor.characterId } : {}),
      ...(actor.characterName ? { characterName: actor.characterName } : {}),
      ...(actor.characterColor ? { characterColor: actor.characterColor } : {}),
      ...(actor.characterAvatar
        ? { characterAvatar: actor.characterAvatar }
        : {}),
      ...(actor.characterMaxHp ? { characterMaxHp: actor.characterMaxHp } : {}),
      commandWindowStartedAt: Date.now(),
      commandCount: 0,
    } satisfies SocketAttachment);
    this.safeSend(server, projectRoomState(this.requireState(), actor));
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  private async createSceneRoute(
    request: Request,
    actor: RoomActor,
  ): Promise<Response> {
    this.requireModerator(actor);
    const body = await objectBody(request);
    const name = text(body.name, "场景名称");
    const result = this.mutate(
      actor,
      clientCommandId(body.id),
      "scene.create",
      (next) => {
        const scene = addScene(next, name);
        return { sceneId: scene.id };
      },
      [],
    );
    this.broadcastState();
    const sceneId = (result.payload as { sceneId: string }).sceneId;
    return this.respondJson(this.requireState().scenes[sceneId], 201);
  }

  private async moduleRoute(route: ModuleRoute, request: Request, actor: RoomActor, param?: string): Promise<Response> {
    if (route.moderatorOnly) this.requireModerator(actor);
    const result = await route.handle({
      method: request.method as 'GET' | 'POST',
      param: param === undefined ? undefined : decodeURIComponent(param),
      actor,
      state: () => this.requireState(),
      body: () => objectBody(request),
      mutate: (commandId, action, update, sceneIds) => {
        const { payload } = this.mutate(actor, clientCommandId(commandId), action, update, sceneIds);
        this.broadcastState();
        return payload;
      },
    });
    return this.respondJson(result.body, result.status);
  }

  private deleteSceneRoute(actor: RoomActor, sceneId: string): Response {
    this.requireModerator(actor);
    const result = this.mutate(
      actor,
      crypto.randomUUID(),
      "scene.delete",
      (next) => {
        if (!deleteScene(next, sceneId))
          throw new DomainError("INVALID", "至少需要保留一个场景");
        this.ensureConnectedPlayers(next);
        return { sceneId };
      },
      [],
    );
    this.broadcastState();
    return this.respondJson({ ok: true, revision: result.revision });
  }

  private provisionCharacterRoute(actor: RoomActor): Response {
    if (actor.role !== "player" || !actor.characterId) {
      throw new DomainError("FORBIDDEN", "请先为当前战役选择角色");
    }
    let player: PlayerToken | null = null;
    const result = this.mutate(
      actor,
      crypto.randomUUID(),
      "player.character.select",
      (next) => {
        const scene = activeScene(next);
        scene.players = scene.players.filter(
          (candidate) => candidate.sessionId !== actor.userId,
        );
        ensurePlayerToken(next, actor);
        player =
          scene.players.find(
            (candidate) => candidate.sessionId === actor.userId,
          ) ?? null;
        return { characterId: actor.characterId };
      },
    );
    this.broadcastState();
    return this.respondJson({ ok: true, revision: result.revision, player });
  }

  private getScene(actor: RoomActor, sceneId: string): Response {
    const scene = this.requireState().scenes[sceneId];
    if (!scene || (!isRoomModerator(actor.role) && !scene.unlocked))
      return this.respondJson(
        { error: { code: "NOT_FOUND", message: "找不到场景" } },
        404,
      );
    const copy = projectRoomState({ ...this.requireState(), currentSceneId: sceneId }, actor).scene;
    return this.respondJson(copy);
  }

  private listScenes(
    actor: RoomActor,
  ): Array<{ id: string; name: string; unlocked: boolean }> {
    const campaign = activeCampaign(this.requireState());
    return campaign.sceneIds.flatMap((id) => {
      const scene = this.requireState().scenes[id];
      if (!scene || (!isRoomModerator(actor.role) && !scene.unlocked))
        return [];
      return [
        { id: scene.id, name: scene.name, unlocked: Boolean(scene.unlocked) },
      ];
    });
  }

  private bootstrap(actor: RoomActor): {
    room: { id: string };
    state: ReturnType<typeof projectRoomState>;
    membership: { role: RoomRole; canManage: boolean };
  } {
    return {
      room: { id: this.ctx.id.toString() },
      state: projectRoomState(this.requireState(), actor),
      membership: { role: actor.role, canManage: isRoomModerator(actor.role) },
    };
  }

  private mutate<T>(
    actor: RoomActor,
    commandId: string,
    action: string,
    update: (next: PersistedRoomState) => T,
    sceneIds?: string[],
    copyCampaign = action === "scene.create" || action === "scene.delete",
  ): { revision: number; payload: T; duplicate: boolean } {
    this.requireActor(actor);
    const prior = this.ctx.storage.sql
      .exec<ReceiptRow>(
        "SELECT revision,result_json FROM command_receipts WHERE actor_member_id=?1 AND command_id=?2",
        actor.memberId,
        commandId,
      )
      .toArray()[0];
    if (prior)
      return {
        revision: prior.revision,
        payload: JSON.parse(prior.result_json) as T,
        duplicate: true,
      };
    const current = this.requireState();
    const next: PersistedRoomState = {
      ...current,
      campaign: copyCampaign
        ? structuredClone(current.campaign)
        : current.campaign,
      scenes: { ...current.scenes },
    };
    for (const id of sceneIds ?? [current.currentSceneId])
      if (current.scenes[id])
        next.scenes[id] = structuredClone(current.scenes[id]);
    const payload = update(next);
    next.revision = current.revision + 1;
    this.ctx.storage.transactionSync(() => {
      this.store.save(next, current);
      this.ctx.storage.sql.exec(
        "INSERT INTO campaign_events(actor_member_id,command_id,action,revision,created_at) VALUES(?1,?2,?3,?4,?5)",
        actor.memberId,
        commandId,
        action,
        next.revision,
        Date.now(),
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO command_receipts(actor_member_id,command_id,revision,result_json) VALUES(?1,?2,?3,?4)",
        actor.memberId,
        commandId,
        next.revision,
        JSON.stringify(payload),
      );
    });
    this.state = next;
    return { revision: next.revision, payload, duplicate: false };
  }

  private requireState(): PersistedRoomState {
    if (!this.state) throw new DomainError("CORRUPT_STATE", "房间尚未初始化");
    return this.state;
  }

  private requireModerator(actor: RoomActor): void {
    if (!isRoomModerator(actor.role))
      throw new DomainError("FORBIDDEN", "没有此操作权限");
  }

  // Provision before broadcasting a scene transition, just as a fresh player
  // connection does. Clone only the destination scene that actually changes.
  private ensureConnectedPlayers(next: PersistedRoomState): void {
    const scene = activeScene(next);
    const players = new Map<string, RoomActor>();
    for (const socket of this.ctx.getWebSockets()) {
      const actor = socketActor(socket);
      if (!actor || actor.role !== "player" || !actor.characterId) continue;
      try {
        this.requireActor(actor);
      } catch {
        continue;
      }
      if (!scene.players.some((player) => player.sessionId === actor.userId))
        players.set(actor.userId, actor);
    }
    if (!players.size) return;
    next.scenes[scene.id] = structuredClone(scene);
    for (const actor of players.values()) ensurePlayerToken(next, actor);
  }

  private broadcastState(): void {
    for (const socket of this.ctx.getWebSockets()) {
      const actor = socketActor(socket);
      if (actor)
        this.safeSend(socket, projectRoomState(this.requireState(), actor));
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
      const patch = actor.supportsPatches
        ? projectPatchOperations(state, operations, actor)
        : null;
      if (patch) {
        this.safeSend(socket, { type: "patch", revision, ops: patch });
      } else {
        this.safeSend(socket, projectRoomState(state, actor));
      }
    }
    // Presence only changes on socket open/close. Sending it after every board
    // operation created needless extra frames beside the former full snapshot.
  }

  private setSocketCapabilities(
    socket: WebSocket,
    actor: SocketAttachment,
    data: Record<string, unknown>,
  ): void {
    if (data.patches !== 1) {
      this.sendError(socket, "INVALID", "客户端能力声明无效");
      return;
    }
    socket.serializeAttachment({
      ...actor,
      supportsPatches: true,
    } satisfies SocketAttachment);
  }

  private broadcastPresence(): void {
    const online = this.ctx.getWebSockets().reduce((count, socket) => {
      const actor = socketActor(socket);
      return count + (actor?.role === "player" ? 1 : 0);
    }, 0);
    for (const socket of this.ctx.getWebSockets())
      this.safeSend(socket, { type: "meta", online });
  }

  private consumeCommandBudget(
    socket: WebSocket,
    actor: SocketAttachment,
  ): boolean {
    const now = Date.now();
    const attachment = { ...actor };
    if (now - attachment.commandWindowStartedAt >= 60_000) {
      attachment.commandWindowStartedAt = now;
      attachment.commandCount = 0;
    }
    attachment.commandCount += 1;
    socket.serializeAttachment(attachment);
    if (attachment.commandCount <= MAX_COMMANDS_PER_MINUTE) return true;
    socket.close(4008, "Rate limit exceeded");
    return false;
  }

  private respondJson(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  private respondError(error: unknown): Response {
    if (error instanceof DomainError) {
      const status =
        error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND"
            ? 404
            : error.code === "INVALID"
              ? 400
              : 500;
      return this.respondJson(
        { error: { code: error.code, message: error.message } },
        status,
      );
    }
    console.error(
      JSON.stringify({
        event: "room_request_failed",
        room: this.ctx.id.toString(),
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return this.respondJson(
      { error: { code: "INTERNAL", message: "房间服务暂时不可用" } },
      500,
    );
  }

  private safeSend(socket: WebSocket, data: unknown): void {
    try {
      const actor = socketActor(socket);
      if (!actor) return;
      this.requireActor(actor);
      socket.send(JSON.stringify(data));
    } catch {
      // A socket may close between getWebSockets() and send(). The hibernation
      // runtime will deliver its close event; there is nothing to retry here.
    }
  }

  private sendDomainError(
    socket: WebSocket,
    error: unknown,
    commandId?: string,
  ): void {
    if (error instanceof DomainError) {
      this.sendError(socket, error.code, error.message, commandId);
      return;
    }
    console.error(
      JSON.stringify({
        event: "room_command_failed",
        room: this.ctx.id.toString(),
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    this.sendError(socket, "INTERNAL", "命令处理失败", commandId);
  }

  private sendError(
    socket: WebSocket,
    code: string,
    message: string,
    commandId?: string,
  ): void {
    this.safeSend(socket, {
      type: "error",
      code,
      message,
      ...(commandId ? { commandId } : {}),
    });
  }
}

/**
 * Turn a server-authorized operation into the smallest operation a particular
 * viewer may apply.  Returning null deliberately falls back to the existing
 * full projection for commands whose result contains generated IDs or a scene
 * switch.  This keeps patching a performance optimization, never a new trust
 * boundary.
 */
export function projectPatchOperations(
  state: PersistedRoomState,
  operations: Op[],
  actor: RoomActor,
): Op[] | null {
  const scene = activeScene(state);
  const canManage = isRoomModerator(actor.role);
  // Visibility transitions need a complete projection to add/remove both token
  // and initiative rows. Also avoid sending movement/edits for hidden tokens.
  if (!canManage && operations.some(op =>
    ['addToken', 'updateToken', 'removeToken'].includes(op.op)
    || (op.op === 'moveToken' && scene.tokens.some(t => t.id === op.tokenId && t.hidden))
    || (scene.tokens.some(t => t.hidden) && ['advanceTurn', 'previousTurn', 'reorderInitiative', 'removeFromInitiative', 'removePlayer'].includes(op.op))
  )) return null;
  const projected: Op[] = [];
  for (const operation of operations) {
    switch (operation.op) {
      case "moveToken":
      case "removeToken":
      case "updateToken":
      case "removePlayer":
      case "addWall":
      case "removeWall":
      case "updateGrid":
      case "updateMap":
      case "addFavorite":
      case "removeFavorite":
      case "revealFogRect":
      case "setFog":
      case "revealAllFog":
      case "coverAllFog":
        projected.push(structuredClone(operation));
        break;
      case "updateMapScale":
        projected.push({ ...operation, fogBasisScale: resolveFogBasisScale(scene) });
        break;
      case "addToken": {
        // Monster numbering is assigned by applyOperation, so use the durable
        // record rather than the browser's pre-authorization payload.
        const token = scene.tokens.find(
          (candidate) => candidate.id === operation.token.id,
        );
        if (!token) return null;
        projected.push({ op: "addToken", token: structuredClone(token) });
        break;
      }
      case "addPlayer": {
        const player = scene.players.find(
          (candidate) => candidate.id === operation.player.id,
        );
        if (!player) return null;
        projected.push({
          op: "addPlayer",
          player: projectPlayerToken(player, actor, canManage),
        });
        break;
      }
      case "updatePlayer": {
        const player = scene.players.find(
          (candidate) => candidate.id === operation.tokenId,
        );
        if (!player) return null;
        const patch = structuredClone(operation.patch);
        if ("sessionId" in patch) {
          patch.sessionId =
            canManage || player.sessionId === actor.userId
              ? player.sessionId
              : null;
        }
        projected.push({
          op: "updatePlayer",
          tokenId: operation.tokenId,
          patch,
        });
        break;
      }
      case "addEnemy":
      case "removeEnemy":
        // Player projections intentionally omit the DM's encounter library.
        if (canManage) projected.push(structuredClone(operation));
        break;
      // Initiative additions can get a server-created ID; scene/campaign
      // switching changes more than one projection field. Retain snapshots
      // for those infrequent operations rather than inventing a lossy patch.
      case "switchCampaign":
      case "submitInitiative":
      case "addToInitiative":
        return null;
      case "removeFromInitiative":
      case "advanceTurn":
      case "previousTurn":
      case "reorderInitiative":
        projected.push(structuredClone(operation));
        break;
    }
  }
  return projected;
}

function projectPlayerToken(
  player: PlayerToken,
  actor: RoomActor,
  canManage: boolean,
): PlayerToken {
  return {
    ...structuredClone(player),
    sessionId:
      canManage || player.sessionId === actor.userId ? player.sessionId : null,
  };
}

function actorFromHeaders(headers: Headers): RoomActor {
  const userId = headers.get("x-dnd-user-id");
  const memberId = headers.get("x-dnd-member-id");
  const role = headers.get("x-dnd-room-role");
  const accessEpoch = Number(headers.get("x-dnd-access-epoch"));
  if (
    !userId ||
    !memberId ||
    !isRoomRole(role) ||
    !Number.isInteger(accessEpoch) ||
    accessEpoch < 1
  ) {
    throw new DomainError("FORBIDDEN", "无效的房间身份");
  }
  const characterMaxHp = Number(headers.get("x-dnd-character-max-hp"));
  return {
    userId,
    memberId,
    role,
    accessEpoch,
    campaignId: headers.get("x-dnd-campaign-id") ?? undefined,
    ...(headers.get("x-dnd-character-id")
      ? { characterId: headers.get("x-dnd-character-id")! }
      : {}),
    ...(headers.get("x-dnd-character-name")
      ? {
          characterName: decodeURIComponent(
            headers.get("x-dnd-character-name")!,
          ),
        }
      : {}),
    ...(headers.get("x-dnd-character-color")
      ? { characterColor: headers.get("x-dnd-character-color")! }
      : {}),
    ...(headers.get("x-dnd-character-avatar")
      ? {
          characterAvatar: decodeURIComponent(
            headers.get("x-dnd-character-avatar")!,
          ),
        }
      : {}),
    ...(Number.isFinite(characterMaxHp) && characterMaxHp > 0
      ? { characterMaxHp }
      : {}),
    ...(headers.get("x-dnd-display-name")
      ? { displayName: decodeURIComponent(headers.get("x-dnd-display-name")!) }
      : {}),
  };
}

function createChatMessage(
  campaignId: string,
  actor: RoomActor,
  input: string,
  visibility: ChatMessage["visibility"],
): ChatMessage {
  const rollMatch =
    /^\/(?:r|roll)\s+(\d{1,2})d(\d{1,4})(?:\s*([+-])\s*(\d{1,4}))?$/iu.exec(
      input.trim(),
    );
  if (!rollMatch) {
    return {
      id: crypto.randomUUID(),
      campaignId,
      userId: actor.userId,
      author: actor.displayName || "冒险者",
      kind: "chat",
      text: input,
      visibility,
      createdAt: Date.now(),
    };
  }
  const count = Math.min(50, Number(rollMatch[1]));
  const faces = Math.min(10_000, Number(rollMatch[2]));
  if (count < 1 || faces < 2) throw new DomainError("INVALID", "骰子公式无效");
  const modifier = rollMatch[4]
    ? Number(rollMatch[4]) * (rollMatch[3] === "-" ? -1 : 1)
    : 0;
  const rolls = Array.from({ length: count }, () => randomDie(faces));
  const total = rolls.reduce((sum, value) => sum + value, modifier);
  return {
    id: crypto.randomUUID(),
    campaignId,
    userId: actor.userId,
    author: actor.displayName || "冒险者",
    kind: "roll",
    text: input,
    formula: `${count}d${faces}${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ""}`,
    rolls,
    total,
    visibility,
    createdAt: Date.now(),
  };
}

function randomDie(faces: number): number {
  const limit = Math.floor(0x1_0000_0000 / faces) * faces;
  const bytes = new Uint32Array(1);
  do crypto.getRandomValues(bytes);
  while (bytes[0] >= limit);
  return (bytes[0] % faces) + 1;
}

function socketActor(socket: WebSocket): SocketAttachment | null {
  const value: unknown = socket.deserializeAttachment();
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.userId !== "string" ||
    typeof value.memberId !== "string" ||
    !isRoomRole(value.role) ||
    typeof value.accessEpoch !== "number" ||
    typeof value.commandWindowStartedAt !== "number" ||
    typeof value.commandCount !== "number"
  )
    return null;
  return value as unknown as SocketAttachment;
}

function isRoomRole(value: unknown): value is RoomRole {
  return (
    value === "host" ||
    value === "dm" ||
    value === "assistant_dm" ||
    value === "player" ||
    value === "spectator"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function objectBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new DomainError("INVALID", "请求必须是 JSON 对象");
  }
  if (!isRecord(value))
    throw new DomainError("INVALID", "请求必须是 JSON 对象");
  return value;
}

function text(value: unknown, label: string, maximumLength = 120): string {
  if (typeof value !== "string")
    throw new DomainError("INVALID", `${label}无效`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength)
    throw new DomainError("INVALID", `${label}长度无效`);
  return normalized;
}

function clientCommandId(value: unknown): string {
  if (typeof value === "string" && value.length > 0 && value.length <= 180)
    return value;
  return crypto.randomUUID();
}

// Keep imported shared types present in generated declaration output. They are
// used structurally by the persistent state but this explicit reference makes
// the room-state boundary easy to locate in IDE navigation.
void ({} as Campaign | Scene);
