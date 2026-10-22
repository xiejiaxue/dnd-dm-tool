import { calendarPayload } from "./calendar";
import { findModuleRoute, moduleMonsterCard, moduleToken, searchModules } from "./modules/registry";
import {
  getOrCreateSession,
  revokeCurrentSession,
  type SessionContext,
} from "./auth";
import {
  HttpError,
  errorResponse,
  isRecord,
  json,
  nonEmptyText,
  readJsonObject,
  requestId,
  requireSameOrigin,
  routeParts,
  withSetCookie,
} from "./http";
import {
  createUserCampaign,
  listUserCampaigns,
  userModules,
  requireCampaignAccess,
  campaignMembers,
  removeCampaignMember,
  setCampaignStatus,
} from "./campaigns";
import { getPublicSiteConfig } from "./public-config";
import {
  consumeOnlineLookupBudget,
  getOnlineCompendiumEntry,
  onlineEntryReference,
  OnlineCompendiumRateLimitDurableObject,
  searchOnlineCompendium,
} from "./online-compendium";
import { parseOnlineSearchRequest } from "./online-compendium-data";
import {
  callRoom,
  addSelectedCharacterEntry,
  createCampaignJournal,
  createCampaignCharacter,
  createAsset,
  createRoomInvite,
  forwardRoomWebSocket,
  getAsset,
  getSelectedCharacterSheet,
  initializeRoom,
  listCampaignCharacters,
  listCampaignJournals,
  redeemRoomInvite,
  removeSelectedCharacterEntry,
  requireRoomAccess,
  selectCampaignCharacter,
  updateCampaignJournal,
  type RoomAccess,
} from "./repository";

export { RoomDurableObject } from "./room";
export { OnlineCompendiumRateLimitDurableObject };

interface CompendiumIndexRow {
  type: string;
  id: string;
  nameZh: string;
  nameEn: string;
  source: string;
  bookFile: string;
  cr?: string;
  level?: number;
  lookupKey?: string;
}

const worker: ExportedHandler<Env> = {
  async fetch(request, env, ctx): Promise<Response> {
    const id = requestId(request);
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      // Static Assets handles non-API paths (including /c/:slug SPA routes).
      // This branch is a defensive fallback for a worker-first route override.
      return new Response("Not found", { status: 404 });
    }

    let sessionContext: SessionContext | undefined;
    try {
      if (url.pathname === "/api/health")
        return json({ ok: true, runtime: "cloudflare-worker" });
      // This endpoint must not create an anonymous session merely to render a
      // legal footer.  It contains only explicitly configured public strings.
      if (url.pathname === "/api/public-config" && request.method === "GET") {
        return json(getPublicSiteConfig(env), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method))
        requireSameOrigin(request);
      sessionContext = await getOrCreateSession(env, request);
      const response = await routeApi(request, env, ctx, sessionContext, url);
      console.log(
        JSON.stringify({
          event: "api_request",
          requestId: id,
          method: request.method,
          path: url.pathname,
          status: response.status,
        }),
      );
      return withSetCookie(response, sessionContext.setCookie);
    } catch (error) {
      return withSetCookie(errorResponse(error, id), sessionContext?.setCookie);
    }
  },
};

export default worker;

async function routeApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  sessionContext: SessionContext,
  url: URL,
): Promise<Response> {
  const { session } = sessionContext;
  if (url.pathname === '/api/calendar' && request.method === 'GET') {
    const slug = url.searchParams.get('campaign');
    const access = slug ? await requireCampaignAccess(env, session.userId, slug) : null;
    return json(calendarPayload(access?.role ?? null));
  }

  const parts = routeParts(url.pathname);

  if (parts.length === 2 && parts[1] === "me" && request.method === "GET") {
    return json({
      id: session.userId,
      displayName: session.displayName,
      isAnonymous: true,
    });
  }
  if (
    parts.length === 3 &&
    parts[1] === "auth" &&
    parts[2] === "logout" &&
    request.method === "POST"
  ) {
    await revokeCurrentSession(env, session);
    return json(
      { ok: true },
      { headers: { "set-cookie": expiredSessionCookie(request) } },
    );
  }
  if (parts.length === 2 && parts[1] === "search" && request.method === "GET")
    return searchCompendium(env, url);
  if (
    parts.length === 3 &&
    parts[1] === "search" &&
    parts[2] === "online" &&
    request.method === "GET"
  ) {
    let onlineRequest;
    try {
      onlineRequest = parseOnlineSearchRequest(url);
    } catch (error) {
      throw new HttpError(
        400,
        "INVALID_INPUT",
        error instanceof Error ? error.message : "资料查询无效",
      );
    }
    if (!onlineRequest.query) return json([]);
    await consumeOnlineLookupBudget(env, request, session.userId);
    return searchOnlineCompendium(ctx, onlineRequest);
  }
  if (parts.length === 4 && parts[1] === "entry" && request.method === "GET") {
    const onlineReference = onlineEntryReference(parts[2], parts[3]);
    if (onlineReference) {
      await consumeOnlineLookupBudget(env, request, session.userId);
      return getOnlineCompendiumEntry(ctx, onlineReference);
    }
    return getCompendiumEntry(env, parts[2], parts[3]);
  }
  if (parts.length === 3 && parts[1] === "token" && request.method === "GET")
    return getCompendiumToken(env, parts[2]);

  if (
    parts.length === 2 &&
    parts[1] === "invites" &&
    request.method === "POST"
  ) {
    // This is intentionally not a valid route; keep invite redemption below
    // explicit so a malformed path cannot accidentally consume a credential.
    throw new HttpError(404, "NOT_FOUND", "找不到邀请操作");
  }
  if (
    parts.length === 3 &&
    parts[1] === "invites" &&
    parts[2] === "redeem" &&
    request.method === "POST"
  ) {
    const body = await readJsonObject(request);
    const token = nonEmptyText(body.token, "邀请令牌", 300);
    const redeemed = await redeemRoomInvite(env, session, token);
    ctx.waitUntil(writeInviteAudit(env, session.userId, redeemed.campaignSlug));
    return json(redeemed);
  }

  if (parts.length === 2 && parts[1] === "modules" && request.method === "GET")
    return json(await userModules(env, session.userId));
  if (parts.length === 2 && parts[1] === "campaigns") {
    if (request.method === "GET")
      return json({
        campaigns: await listUserCampaigns(
          env,
          session.userId,
          url.searchParams.get("status") === "archived",
        ),
      });
    if (request.method === "POST") {
      const body = await readJsonObject(request);
      const access = await createUserCampaign(env, session, {
        name: optionalText(body.name, "战役名称"),
        moduleId: optionalText(body.moduleId, "模组 ID"),
        copyMembersFrom: optionalText(body.copyMembersFrom, "来源战役"),
      });
      await initializeRoom(env, access);
      ctx.waitUntil(
        writeAudit(
          env,
          access,
          "campaign.create",
          "campaign",
          access.campaignId,
        ),
      );
      return json({ campaign: roomSummary(access) }, { status: 201 });
    }
  }
  if (parts.length >= 3 && parts[1] === "campaigns") {
    const slug = parts[2],
      rest = parts.slice(3);
    const managing =
      (rest.length === 1 && ["archive", "restore"].includes(rest[0])) ||
      (rest.length === 0 && request.method === "DELETE");
    const access = await requireCampaignAccess(
      env,
      session.userId,
      slug,
      managing,
    );
    if (managing) {
      if (request.method !== "POST" && request.method !== "DELETE")
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "请求方式无效");
      // Initialize before changing status so no half-created runtime can block a restore.
      await initializeRoom(env, access);
      const status =
        request.method === "DELETE"
          ? "deleted"
          : rest[0] === "archive"
            ? "archived"
            : "active";
      await setCampaignStatus(env, access, status);
      const synced = await callRoom(env, access, "POST", "/refresh-access");
      if (!synced.ok)
        throw new HttpError(
          503,
          "ACCESS_SYNC_PENDING",
          "权限更新待同步，请重试",
        );
      return json({ ok: true, status });
    }
    if (rest[0] === "members") {
      if (rest.length === 1 && request.method === "GET")
        return json({ members: await campaignMembers(env, access) });
      if (rest.length === 2 && request.method === "DELETE") {
        await initializeRoom(env, access);
        await removeCampaignMember(env, access, rest[1]);
        const synced = await callRoom(env, access, "POST", "/refresh-access");
        if (!synced.ok)
          throw new HttpError(
            503,
            "ACCESS_SYNC_PENDING",
            "权限更新待同步，请重试",
          );
        return json({ ok: true });
      }
    }
    return routeRoomApi(request, env, ctx, access, rest);
  }

  throw new HttpError(404, "NOT_FOUND", "找不到接口");
}

async function routeRoomApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  access: RoomAccess,
  rest: string[],
): Promise<Response> {
  if (rest.length === 0 && request.method === "GET") {
    const response = await callRoom(env, access, "GET", "/bootstrap");
    if (!response.ok) return response;
    const payload = (await response.json()) as {
      state?: unknown;
      membership?: unknown;
    };
    return json({
      campaign: roomSummary(access),
      membership: {
        role: access.role,
        roomRole: access.role,
        canManage:
          access.role === "host" ||
          access.role === "dm" ||
          access.role === "assistant_dm",
      },
      state: payload.state,
      selectedCharacter: access.characterId
        ? {
            id: access.characterId,
            campaignId: access.campaignId,
            name: access.characterName,
            color: access.characterColor,
            avatarUrl: access.characterAvatar,
            maxHp: access.characterMaxHp,
          }
        : null,
    });
  }
  if (rest.length === 1 && rest[0] === "ws" && request.method === "GET") {
    requireSameOrigin(request);
    return forwardRoomWebSocket(env, access, request);
  }
  if (rest.length === 1 && rest[0] === "invites" && request.method === "POST") {
    const body = await readJsonObject(request);
    const invite = await createRoomInvite(env, access, {
      role: body.role,
      maxUses: body.maxUses,
    });
    ctx.waitUntil(
      writeAudit(env, access, "invite.create", "campaign", access.roomId),
    );
    return json(invite, { status: 201 });
  }
  if (rest.length === 1 && rest[0] === "assets") {
    if (request.method === "POST") {
      const declaredLength = Number(request.headers.get("content-length") ?? 0);
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > 11 * 1024 * 1024
      ) {
        throw new HttpError(413, "PAYLOAD_TOO_LARGE", "图片必须小于 10 MiB");
      }
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        throw new HttpError(400, "INVALID_INPUT", "需要上传图片文件");
      const asset = await createAsset(env, access, file, form.get("kind"));
      ctx.waitUntil(writeAudit(env, access, "asset.upload", "asset", asset.id));
      return json(asset, { status: 201 });
    }
  }
  if (rest.length === 2 && rest[0] === "assets" && request.method === "GET") {
    const asset = await getAsset(env, access, rest[1]);
    const headers = new Headers({
      "content-type": asset.metadata.content_type,
      "content-length": String(asset.metadata.byte_size),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    });
    return new Response(asset.object.body, { headers });
  }
  const moduleRoute = rest.length <= 2 ? findModuleRoute(rest[0], rest.length === 2, request.method) : undefined;
  if (moduleRoute) {
    const path = `/${moduleRoute.path}${moduleRoute.param ? `/${encodeURIComponent(rest[1])}` : ""}`;
    return callRoom(env, access, request.method, path, request.method === "POST" ? await readJsonObject(request) : undefined);
  }
  if (rest[0] === "scenes") {
    if (
      rest.length === 1 &&
      (request.method === "GET" || request.method === "POST")
    ) {
      return callRoom(
        env,
        access,
        request.method,
        "/scenes",
        request.method === "POST" ? await readJsonObject(request) : undefined,
      );
    }
    if (
      rest.length === 2 &&
      (request.method === "GET" || request.method === "DELETE")
    ) {
      return callRoom(
        env,
        access,
        request.method,
        `/scenes/${encodeURIComponent(rest[1])}`,
      );
    }
  }
  if (rest[0] === "journals") {
    if (rest.length === 1 && request.method === "GET")
      return json(await listCampaignJournals(env, access));
    if (rest.length === 1 && request.method === "POST") {
      const body = await readJsonObject(request);
      const journal = await createCampaignJournal(env, access, {
        title: nonEmptyText(body.title, "日志标题", 160),
        content: typeof body.content === "string" ? body.content : undefined,
        visibility:
          typeof body.visibility === "string" ? body.visibility : undefined,
      });
      return json(journal, { status: 201 });
    }
    if (rest.length === 2 && request.method === "POST") {
      const body = await readJsonObject(request);
      return json(
        await updateCampaignJournal(env, access, rest[1], {
          title: nonEmptyText(body.title, "日志标题", 160),
          content: typeof body.content === "string" ? body.content : undefined,
          visibility:
            typeof body.visibility === "string" ? body.visibility : undefined,
        }),
      );
    }
  }
  if (rest[0] === "character-sheet") {
    if (rest.length === 1 && request.method === "GET")
      return json(await getSelectedCharacterSheet(env, access));
    if (
      rest.length === 2 &&
      rest[1] === "entries" &&
      request.method === "POST"
    ) {
      const body = await readJsonObject(request);
      return json(
        await addSelectedCharacterEntry(env, access, {
          type: nonEmptyText(body.type, "资料类型", 40),
          entryId: nonEmptyText(body.entryId, "资料 ID", 300),
          name: nonEmptyText(body.name, "资料名称", 160),
          source: typeof body.source === "string" ? body.source : undefined,
        }),
        { status: 201 },
      );
    }
    if (
      rest.length === 3 &&
      rest[1] === "entries" &&
      request.method === "DELETE"
    ) {
      await removeSelectedCharacterEntry(env, access, rest[2]);
      return json({ ok: true });
    }
  }
  if (rest[0] === "characters") {
    if (rest.length === 1 && request.method === "GET") {
      const campaignId =
        new URL(request.url).searchParams.get("campaignId") ??
        access.campaignId;
      return json(await listCampaignCharacters(env, access, campaignId));
    }
    if (rest.length === 1 && request.method === "POST") {
      const body = await readJsonObject(request);
      const character = await createCampaignCharacter(env, access, {
        campaignId: nonEmptyText(body.campaignId, "战役 ID", 180),
        name: nonEmptyText(body.name, "角色名称"),
        color: optionalText(body.color, "角色颜色"),
        maxHp: typeof body.maxHp === "number" ? body.maxHp : undefined,
      });
      return json(character, { status: 201 });
    }
    if (
      rest.length === 3 &&
      rest[2] === "select" &&
      request.method === "POST"
    ) {
      const body = await readJsonObject(request);
      const campaignId = nonEmptyText(body.campaignId, "战役 ID", 180);
      const character = await selectCampaignCharacter(
        env,
        access,
        campaignId,
        rest[1],
      );
      const refreshed = await requireRoomAccess(
        env,
        access.userId,
        access.roomSlug,
      );
      if (campaignId === refreshed.campaignId && refreshed.role === "player") {
        const response = await callRoom(
          env,
          refreshed,
          "POST",
          "/characters/provision",
        );
        if (!response.ok) return response;
      }
      return json(character);
    }
  }
  throw new HttpError(404, "NOT_FOUND", "找不到房间接口");
}

function roomSummary(access: RoomAccess): {
  id: string;
  slug: string;
  name: string;
  role: string;
  status: string;
  campaignName: string;
  updatedAt: number;
} {
  return {
    id: access.roomId,
    slug: access.roomSlug,
    name: access.roomName,
    role: access.role,
    status: access.roomStatus,
    campaignName: access.campaignName,
    updatedAt: Date.now(),
  };
}

function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : nonEmptyText(value, label);
}

async function searchCompendium(env: Env, url: URL): Promise<Response> {
  const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase();
  const requestedType = url.searchParams.get("type") ?? "all";
  if (!query) return json([]);
  const index = await env.REFERENCE_DATA.get("compendium/index.json");
  if (!index) return json(searchModules(query, requestedType).slice(0, 50));
  const source: unknown = await index.json();
  if (!Array.isArray(source)) return json(searchModules(query, requestedType).slice(0, 50));
  const entries = source.flatMap((item) =>
    asCompendiumIndexRow(item) ? [item] : [],
  );
  const matches = [...searchModules(query, requestedType), ...entries]
    .filter((entry) => {
      if (requestedType !== "all" && entry.type !== requestedType) return false;
      return `${entry.nameZh} ${entry.nameEn} ${entry.id} ${entry.source}`
        .toLocaleLowerCase()
        .includes(query);
    })
    .slice(0, 50);
  return json(matches);
}

async function getCompendiumEntry(
  env: Env,
  type: string,
  id: string,
): Promise<Response> {
  if (!isCompendiumType(type))
    throw new HttpError(404, "NOT_FOUND", "找不到资料条目");
  if (!id || id.length > 180)
    throw new HttpError(404, "NOT_FOUND", "找不到资料条目");
  const builtin = type === "monster" ? moduleMonsterCard(id) : undefined;
  if (builtin) return json(builtin);
  const indexObject = await env.REFERENCE_DATA.get("compendium/index.json");
  if (!indexObject) throw new HttpError(404, "NOT_FOUND", "找不到资料条目");
  const index: unknown = await indexObject.json();
  const match = Array.isArray(index)
    ? index
        .map(asCompendiumIndexRow)
        .find(
          (entry): entry is CompendiumIndexRow =>
            entry !== null && entry.type === type && entry.id === id,
        )
    : undefined;
  if (!match) throw new HttpError(404, "NOT_FOUND", "找不到资料条目");

  const safeBookPath = match.bookFile
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const book = await env.REFERENCE_DATA.get(`compendium/books/${safeBookPath}`);
  if (!book) throw new HttpError(404, "NOT_FOUND", "找不到资料条目");
  const source: unknown = await book.json();
  const records = compendiumRecords(source, type);
  const entry = records.find((record) => {
    if (!isRecord(record)) return false;
    const name =
      typeof record.ENG_name === "string" ? record.ENG_name : record.name;
    const key = match.lookupKey
      ? `${typeof record.className === "string" ? record.className : ""}|${name ?? ""}|${typeof record.level === "number" ? record.level : ""}`
      : name;
    return (
      key === (match.lookupKey ?? match.nameEn) &&
      (record.source === match.source || record.classSource === match.source)
    );
  });
  if (!entry) throw new HttpError(404, "NOT_FOUND", "找不到资料条目");
  return json(entry, {
    headers: {
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

async function getCompendiumToken(env: Env, id: string): Promise<Response> {
  if (!id || id.length > 180)
    throw new HttpError(404, "NOT_FOUND", "找不到 Token");
  const builtin = moduleToken(id);
  if (builtin) return new Response(builtin, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
  const token = await env.REFERENCE_DATA.get(
    `compendium/tokens/${encodeURIComponent(id)}.webp`,
  );
  if (token)
    return new Response(token.body, {
      headers: {
        "content-type": "image/webp",
        "cache-control": "public, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  const label = escapeXml(id.split("__").at(-1)?.slice(0, 2) || "?");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${label}"><rect width="64" height="64" rx="32" fill="#3f3f46"/><text x="32" y="40" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#fbbf24">${label}</text></svg>`;
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

function asCompendiumIndexRow(value: unknown): CompendiumIndexRow | null {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    typeof value.id !== "string" ||
    typeof value.nameZh !== "string" ||
    typeof value.nameEn !== "string" ||
    typeof value.source !== "string" ||
    typeof value.bookFile !== "string"
  )
    return null;
  return {
    type: value.type,
    id: value.id,
    nameZh: value.nameZh,
    nameEn: value.nameEn,
    source: value.source,
    bookFile: value.bookFile,
    ...(typeof value.cr === "string" ? { cr: value.cr } : {}),
    ...(typeof value.level === "number" ? { level: value.level } : {}),
    ...(typeof value.lookupKey === "string"
      ? { lookupKey: value.lookupKey }
      : {}),
  };
}

function isCompendiumType(value: string): boolean {
  return [
    "monster",
    "spell",
    "item",
    "feat",
    "condition",
    "race",
    "subrace",
    "background",
    "class",
    "subclass",
    "classFeature",
    "subclassFeature",
    "optionalFeature",
    "language",
    "vehicle",
    "action",
    "reward",
  ].includes(value);
}

function compendiumRecords(value: unknown, type: string): unknown[] {
  if (!isRecord(value)) return [];
  const keyByType: Record<string, string> = {
    monster: "monster",
    spell: "spell",
    item: "item",
    feat: "feat",
    condition: "condition",
    race: "race",
    subrace: "subrace",
    background: "background",
    class: "class",
    subclass: "subclass",
    classFeature: "classFeature",
    subclassFeature: "subclassFeature",
    optionalFeature: "optionalfeature",
    language: "language",
    vehicle: "vehicle",
    action: "action",
    reward: "reward",
  };
  const candidate = value[keyByType[type] ?? type];
  return Array.isArray(candidate) ? candidate : [];
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] ?? character,
  );
}

async function writeAudit(
  env: Env,
  access: RoomAccess,
  action: string,
  targetType: string,
  targetId: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_events(id,workspace_id,campaign_id,actor_user_id,actor_campaign_member_id,action,target_type,target_id,outcome,occurred_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'success',?9)`,
  )
    .bind(
      crypto.randomUUID(),
      access.workspaceId,
      access.campaignId,
      access.userId,
      access.memberId,
      action,
      targetType,
      targetId,
      Date.now(),
    )
    .run();
}
async function writeInviteAudit(
  env: Env,
  userId: string,
  slug: string,
): Promise<void> {
  const access = await requireCampaignAccess(env, userId, slug);
  await writeAudit(env, access, "invite.redeem", "campaign", access.campaignId);
}

function expiredSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:";
  return `${secure ? "__Host-dnd-session" : "dnd_session"}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
