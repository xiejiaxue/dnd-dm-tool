import { getOrCreateSession, revokeCurrentSession, type SessionContext } from './auth';
import { HttpError, errorResponse, isRecord, json, nonEmptyText, readJsonObject, requestId, requireSameOrigin, routeParts, withSetCookie } from './http';
import { getPublicSiteConfig } from './public-config';
import {
  consumeOnlineLookupBudget,
  getOnlineCompendiumEntry,
  onlineEntryReference,
  OnlineCompendiumRateLimitDurableObject,
  searchOnlineCompendium,
} from './online-compendium';
import { parseOnlineSearchRequest } from './online-compendium-data';
import { monsterInitiativeModifier } from '../../shared/compendium';
import { resolveNpcInitiativeSource } from '../../shared/npc-metadata';
import type { NpcRecord, Op, Token } from '../../shared/types';
import {
  callRoom,
  createAsset,
  createRoom,
  createRoomInvite,
  deleteRoom,
  deleteRoomAssets,
  deleteRoomLiveState,
  forwardRoomWebSocket,
  getAsset,
  initializeRoom,
  listRooms,
  redeemRoomInvite,
  requireRoomHost,
  requireRoomModerator,
  requireRoomAccess,
  type RoomAccess,
} from './repository';
import { getRoomTemplateAsset, listRoomTemplates, loadRoomTemplate } from './room-templates';

export { RoomDurableObject } from './room';
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
  initiativeModifier?: number;
  hitPoints?: number;
  hasToken?: boolean;
}

const FIVETOOLS_IMAGE_COMMIT = 'd88261f6468d2957e95bbdf56ad65e4ec8d06c73';
const FIVETOOLS_TOKEN_BASE_URL = `https://raw.githubusercontent.com/5etools-mirror-3/5etools-img/${FIVETOOLS_IMAGE_COMMIT}/bestiary/tokens/`;
const MAX_TOKEN_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_AUTOMATIC_INITIATIVE_TOKENS = 250;

const worker: ExportedHandler<Env> = {
  async fetch(request, env, ctx): Promise<Response> {
    const id = requestId(request);
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      // Static Assets handles non-API paths (including /r/:slug SPA routes).
      // This branch is a defensive fallback for a worker-first route override.
      return new Response('Not found', { status: 404 });
    }

    let sessionContext: SessionContext | undefined;
    try {
      if (url.pathname === '/api/health') return json({ ok: true, runtime: 'cloudflare-worker' });
      // This endpoint must not create an anonymous session merely to render a
      // legal footer.  It contains only explicitly configured public strings.
      if (url.pathname === '/api/public-config' && request.method === 'GET') {
        return json(getPublicSiteConfig(env), { headers: { 'cache-control': 'no-store' } });
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) requireSameOrigin(request);
      sessionContext = await getOrCreateSession(env, request);
      const response = await routeApi(request, env, ctx, sessionContext, url);
      console.log(JSON.stringify({ event: 'api_request', requestId: id, method: request.method, path: url.pathname, status: response.status }));
      return withSetCookie(response, sessionContext.setCookie);
    } catch (error) {
      return withSetCookie(errorResponse(error, id), sessionContext?.setCookie);
    }
  },
};

export default worker;

async function routeApi(request: Request, env: Env, ctx: ExecutionContext, sessionContext: SessionContext, url: URL): Promise<Response> {
  const { session } = sessionContext;
  const parts = routeParts(url.pathname);

  if (parts.length === 2 && parts[1] === 'me' && request.method === 'GET') {
    return json({ id: session.userId, displayName: session.displayName, isAnonymous: true });
  }
  if (parts.length === 3 && parts[1] === 'auth' && parts[2] === 'logout' && request.method === 'POST') {
    await revokeCurrentSession(env, session);
    return json({ ok: true }, { headers: { 'set-cookie': expiredSessionCookie(request) } });
  }
  if (parts.length === 2 && parts[1] === 'search' && request.method === 'GET') return searchCompendium(env, url);
  if (parts.length === 2 && parts[1] === 'room-templates' && request.method === 'GET') {
    return json({ templates: await listRoomTemplates(env) });
  }
  if (parts.length === 3 && parts[1] === 'search' && parts[2] === 'online' && request.method === 'GET') {
    let onlineRequest;
    try {
      onlineRequest = parseOnlineSearchRequest(url);
    } catch (error) {
      throw new HttpError(400, 'INVALID_INPUT', error instanceof Error ? error.message : '资料查询无效');
    }
    if (!onlineRequest.query) return json([]);
    await consumeOnlineLookupBudget(env, request, session.userId);
    return searchOnlineCompendium(ctx, onlineRequest);
  }
  if (parts.length === 4 && parts[1] === 'entry' && request.method === 'GET') {
    const onlineReference = onlineEntryReference(parts[2], parts[3]);
    if (onlineReference) {
      await consumeOnlineLookupBudget(env, request, session.userId);
      return getOnlineCompendiumEntry(ctx, onlineReference);
    }
    return getCompendiumEntry(env, parts[2], parts[3]);
  }
  if (parts.length === 3 && parts[1] === 'token' && request.method === 'GET') {
    if (onlineEntryReference('monster', parts[2])) await consumeOnlineLookupBudget(env, request, session.userId);
    return getCompendiumToken(env, ctx, parts[2]);
  }

  if (parts.length === 2 && parts[1] === 'invites' && request.method === 'POST') {
    // This is intentionally not a valid route; keep invite redemption below
    // explicit so a malformed path cannot accidentally consume a credential.
    throw new HttpError(404, 'NOT_FOUND', '找不到邀请操作');
  }
  if (parts.length === 3 && parts[1] === 'invites' && parts[2] === 'redeem' && request.method === 'POST') {
    const body = await readJsonObject(request);
    const token = nonEmptyText(body.token, '邀请令牌', 300);
    const redeemed = await redeemRoomInvite(env, session, token);
    ctx.waitUntil(writeInviteAudit(env, session.userId, redeemed.roomSlug));
    return json(redeemed);
  }

  if (parts.length === 2 && parts[1] === 'rooms') {
    if (request.method === 'GET') return json({ rooms: await listRooms(env, session.userId) });
    if (request.method === 'POST') {
      const body = await readJsonObject(request);
      const templateId = optionalText(body.templateId, '房间模板');
      const template = templateId ? await loadRoomTemplate(env, templateId) : null;
      const access = await createRoom(env, session, {
        roomName: nonEmptyText(body.roomName, '房间名称'),
        campaignName: template?.name ?? optionalText(body.campaignName, '战役名称'),
        templateId: template?.id,
      });
      await initializeRoom(env, access);
      ctx.waitUntil(writeAudit(env, access, 'room.create', 'room', access.roomId));
      return json({ room: roomSummary(access) }, { status: 201 });
    }
  }

  if (parts.length >= 3 && parts[1] === 'rooms') {
    const roomSlug = parts[2];
    const access = await requireRoomAccess(env, session.userId, roomSlug);
    return routeRoomApi(request, env, ctx, access, parts.slice(3));
  }

  throw new HttpError(404, 'NOT_FOUND', '找不到接口');
}

async function routeRoomApi(request: Request, env: Env, ctx: ExecutionContext, access: RoomAccess, rest: string[]): Promise<Response> {
  if (rest.length === 0 && request.method === 'DELETE') {
    requireRoomHost(access);
    // Persist the actor and target before revoking every room membership.
    await writeAudit(env, access, 'room.delete', 'room', access.roomId);
    await deleteRoom(env, access);
    const cleanup = await Promise.allSettled([
      deleteRoomLiveState(env, access),
      deleteRoomAssets(env, access),
    ]);
    for (const result of cleanup) {
      if (result.status === 'rejected') {
        console.error(JSON.stringify({
          event: 'room_delete_cleanup_failed',
          roomId: access.roomId,
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        }));
      }
    }
    return json({ ok: true });
  }
  if (rest.length === 0 && request.method === 'GET') {
    const response = await callRoom(env, access, 'GET', '/bootstrap');
    if (!response.ok) return response;
    const payload = await response.json() as { state?: unknown; membership?: unknown };
    return json({
      room: roomSummary(access),
      membership: { role: access.role, roomRole: access.role, canManage: access.role === 'host' || access.role === 'dm' || access.role === 'assistant_dm' },
      state: payload.state,
    });
  }
  if (rest.length === 1 && rest[0] === 'ws' && request.method === 'GET') {
    requireSameOrigin(request);
    return forwardRoomWebSocket(env, access, request);
  }
  if (rest.length === 1 && rest[0] === 'invites' && request.method === 'POST') {
    const body = await readJsonObject(request);
    const invite = await createRoomInvite(env, access, { role: body.role, maxUses: body.maxUses });
    ctx.waitUntil(writeAudit(env, access, 'invite.create', 'room', access.roomId));
    return json(invite, { status: 201 });
  }
  if (rest.length === 1 && rest[0] === 'assets') {
    if (request.method === 'POST') {
      const declaredLength = Number(request.headers.get('content-length') ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > 11 * 1024 * 1024) {
        throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '图片必须小于 10 MiB');
      }
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) throw new HttpError(400, 'INVALID_INPUT', '需要上传图片文件');
      const asset = await createAsset(env, access, file, form.get('kind'));
      ctx.waitUntil(writeAudit(env, access, 'asset.upload', 'asset', asset.id));
      return json(asset, { status: 201 });
    }
  }
  if (rest.length === 3 && rest[0] === 'template-assets' && request.method === 'GET') {
    if (!access.templateId || access.templateId !== rest[1]) throw new HttpError(404, 'ASSET_NOT_FOUND', '找不到模板素材');
    return getRoomTemplateAsset(env, rest[1], rest[2]);
  }
  if (rest.length === 1 && rest[0] === 'map' && request.method === 'POST') {
    const declaredLength = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 11 * 1024 * 1024) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '图片必须小于 10 MiB');
    }
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'INVALID_INPUT', '需要上传地图图片');
    const width = imageDimension(form.get('width'), '地图宽度');
    const height = imageDimension(form.get('height'), '地图高度');
    const asset = await createAsset(env, access, file, 'map');
    const updated = await callRoom(env, access, 'POST', '/ops', {
      id: crypto.randomUUID(),
      ops: [{
        op: 'updateMap',
        mapImage: asset.url,
        mapSize: [width, height],
        playArea: { x: 0, y: 0, w: width, h: height },
      }],
    });
    if (!updated.ok) return updated;
    ctx.waitUntil(writeAudit(env, access, 'map.update', 'asset', asset.id));
    return json(asset, { status: 201 });
  }
  if (rest.length === 2 && rest[0] === 'assets' && request.method === 'GET') {
    const asset = await getAsset(env, access, rest[1]);
    const headers = new Headers({
      'content-type': asset.metadata.content_type,
      'content-length': String(asset.metadata.byte_size),
      // Asset IDs and object keys are immutable. Private long-lived browser
      // caching avoids downloading the same map again when revisiting a scene.
      'cache-control': 'private, max-age=31536000, immutable',
      'etag': asset.object.httpEtag,
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
      'content-disposition': 'inline',
    });
    return new Response(asset.object.body, { headers });
  }
  if (rest[0] === 'scenes') {
    if (rest.length === 1 && (request.method === 'GET' || request.method === 'POST')) {
      return callRoom(env, access, request.method, '/scenes', request.method === 'POST' ? await readJsonObject(request) : undefined);
    }
    if (rest.length === 2 && (request.method === 'GET' || request.method === 'DELETE')) {
      return callRoom(env, access, request.method, `/scenes/${encodeURIComponent(rest[1])}`);
    }
  }
  if (rest[0] === 'campaigns') {
    if (rest.length === 1 && request.method === 'GET') return callRoom(env, access, 'GET', '/campaigns');
    if (rest.length === 3 && rest[2] === 'scenes' && request.method === 'POST') {
      const body = await readJsonObject(request);
      return callRoom(env, access, 'POST', '/campaigns/assign-scene', { ...body, campaignId: rest[1] });
    }
  }
  if (rest.length === 2 && rest[0] === 'initiative' && rest[1] === 'roll' && request.method === 'POST') {
    requireRoomModerator(access);
    return rollRoomInitiative(env, ctx, access);
  }
  throw new HttpError(404, 'NOT_FOUND', '找不到房间接口');
}

function roomSummary(access: RoomAccess): { id: string; slug: string; name: string; role: string; status: string; campaignName: string; updatedAt: number } {
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

function imageDimension(value: FormDataEntryValue | null, label: string): number {
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20_000) {
    throw new HttpError(400, 'INVALID_INPUT', `${label}必须是 1 到 20000 的整数`);
  }
  return parsed;
}

async function searchCompendium(env: Env, url: URL): Promise<Response> {
  const query = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase();
  const requestedType = url.searchParams.get('type') ?? 'all';
  if (!query) return json([]);
  const entries = await loadCompendiumIndex(env);
  const matches = entries.filter((entry) => {
    if (requestedType !== 'all' && entry.type !== requestedType) return false;
    return `${entry.nameZh} ${entry.nameEn} ${entry.id} ${entry.source}`.toLocaleLowerCase().includes(query);
  }).slice(0, 50);
  return json(matches);
}

async function getCompendiumEntry(env: Env, type: string, id: string): Promise<Response> {
  if (!isCompendiumType(type)) throw new HttpError(404, 'NOT_FOUND', '找不到资料条目');
  if (!id || id.length > 180) throw new HttpError(404, 'NOT_FOUND', '找不到资料条目');
  const entry = await loadCompendiumRecord(env, type, id);
  return json(entry, { headers: { 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
}

async function getCompendiumToken(env: Env, ctx: ExecutionContext, id: string): Promise<Response> {
  if (!id || id.length > 180) throw new HttpError(404, 'NOT_FOUND', '找不到 Token');
  const objectKey = `compendium/tokens/${encodeURIComponent(id)}.webp`;
  const token = await env.REFERENCE_DATA.get(objectKey);
  if (token) return storedTokenResponse(token);

  const reference = await monsterPortraitReference(env, ctx, id);
  if (reference && reference.hasToken !== false) {
    const image = await fetchFiveToolsToken(reference.source, reference.nameEn);
    if (image) {
      await env.REFERENCE_DATA.put(objectKey, image, {
        httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=604800' },
        customMetadata: { source: '5etools-img', upstreamCommit: FIVETOOLS_IMAGE_COMMIT },
      });
      return tokenBytesResponse(image);
    }
  }

  const label = escapeXml((reference?.nameEn ?? id.split('__').at(-1) ?? '?').slice(0, 2));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${label}"><rect width="64" height="64" rx="32" fill="#3f3f46"/><text x="32" y="40" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#fbbf24">${label}</text></svg>`;
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
}

async function loadCompendiumIndex(env: Env): Promise<CompendiumIndexRow[]> {
  const index = await env.REFERENCE_DATA.get('compendium/index.json');
  if (!index) return [];
  const source: unknown = await index.json();
  return Array.isArray(source) ? source.flatMap(item => {
    const entry = asCompendiumIndexRow(item);
    return entry ? [entry] : [];
  }) : [];
}

async function loadCompendiumRecord(
  env: Env,
  type: string,
  id: string,
  indexEntries?: CompendiumIndexRow[],
): Promise<Record<string, unknown>> {
  const match = (indexEntries ?? await loadCompendiumIndex(env)).find(entry => entry.type === type && entry.id === id);
  if (!match) throw new HttpError(404, 'NOT_FOUND', '找不到资料条目');
  const safeBookPath = match.bookFile.split('/').map(encodeURIComponent).join('/');
  const book = await env.REFERENCE_DATA.get(`compendium/books/${safeBookPath}`);
  if (!book) throw new HttpError(404, 'NOT_FOUND', '找不到资料条目');
  const source: unknown = await book.json();
  const entry = firstObjectArray(source).find(record => {
    if (!isRecord(record)) return false;
    const name = typeof record.ENG_name === 'string' ? record.ENG_name : record.name;
    return name === match.nameEn && record.source === match.source;
  });
  if (!isRecord(entry)) throw new HttpError(404, 'NOT_FOUND', '找不到资料条目');
  return entry;
}

async function monsterPortraitReference(env: Env, ctx: ExecutionContext, id: string): Promise<{
  source: string;
  nameEn: string;
  hasToken?: boolean;
} | null> {
  const online = onlineEntryReference('monster', id);
  if (online) {
    // Verify the opaque online id against the reviewed DND5E 不全书 data before
    // it is allowed to select an image path from the fixed 5etools repository.
    await getOnlineCompendiumEntry(ctx, online);
    return { source: online.source, nameEn: online.nameEn };
  }
  const match = (await loadCompendiumIndex(env)).find(entry => entry.type === 'monster' && entry.id === id);
  return match ? { source: match.source, nameEn: match.nameEn, hasToken: match.hasToken } : null;
}

async function fetchFiveToolsToken(source: string, nameEn: string): Promise<Uint8Array | null> {
  const url = `${FIVETOOLS_TOKEN_BASE_URL}${encodeURIComponent(source)}/${encodeURIComponent(nameEn)}.webp`;
  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', redirect: 'manual', headers: { accept: 'image/webp' } });
  } catch {
    return null;
  }
  if (!response.ok || response.headers.get('content-type')?.split(';', 1)[0].trim() !== 'image/webp') return null;
  const bytes = await readLimitedBytes(response, MAX_TOKEN_IMAGE_BYTES);
  return isWebp(bytes) ? bytes : null;
}

async function readLimitedBytes(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) return new Uint8Array();
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return new Uint8Array();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12
    && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP';
}

function storedTokenResponse(token: R2ObjectBody): Response {
  return new Response(token.body, {
    headers: {
      'content-type': token.httpMetadata?.contentType ?? 'image/webp',
      'cache-control': token.httpMetadata?.cacheControl ?? 'public, max-age=604800',
      etag: token.httpEtag,
      'x-content-type-options': 'nosniff',
    },
  });
}

function tokenBytesResponse(bytes: Uint8Array): Response {
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(body, {
    headers: {
      'content-type': 'image/webp',
      'content-length': String(bytes.byteLength),
      'cache-control': 'public, max-age=604800',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function rollRoomInitiative(env: Env, ctx: ExecutionContext, access: RoomAccess): Promise<Response> {
  const bootstrap = await callRoom(env, access, 'GET', '/bootstrap');
  if (!bootstrap.ok) return bootstrap;
  const payload: unknown = await bootstrap.json();
  const scene = isRecord(payload) && isRecord(payload.state) && isRecord(payload.state.scene)
    ? payload.state.scene
    : null;
  const campaign = isRecord(payload) && isRecord(payload.state) && isRecord(payload.state.campaign)
    ? payload.state.campaign
    : null;
  const npcs = campaign && Array.isArray(campaign.npcs)
    ? campaign.npcs.filter(isInitiativeNpc)
    : [];
  const tokens = scene && Array.isArray(scene.tokens)
    ? scene.tokens.filter(isEncounterToken).slice(0, MAX_AUTOMATIC_INITIATIVE_TOKENS)
    : [];

  const sources = new Map(tokens.map(token => [token.id, initiativeSource(token, npcs)]));
  const entryIds = [...new Set([...sources.values()].flatMap(source => source.entryId ? [source.entryId] : []))];
  const compendiumIndex = await loadCompendiumIndex(env);
  const modifiers = new Map<string, number>();
  await Promise.all(entryIds.map(async entryId => {
    try {
      const row = compendiumIndex.find(entry => entry.type === 'monster' && entry.id === entryId);
      if (typeof row?.initiativeModifier === 'number') {
        modifiers.set(entryId, row.initiativeModifier);
        return;
      }
      const online = onlineEntryReference('monster', entryId);
      const record = online
        ? await getOnlineCompendiumEntry(ctx, online).then(response => response.json())
        : await loadCompendiumRecord(env, 'monster', entryId, compendiumIndex);
      modifiers.set(entryId, monsterInitiativeModifier(record));
    } catch {
      modifiers.set(entryId, 0);
    }
  }));

  const rolls = tokens.map(token => ({
    tokenId: token.id,
    name: token.number != null ? `${token.name} #${token.number}` : token.name,
    modifier: (() => {
      const source = sources.get(token.id);
      return source?.entryId ? modifiers.get(source.entryId) ?? 0 : source?.modifier ?? 0;
    })(),
  })).map(roll => ({ ...roll, value: rollD20() + roll.modifier }));

  const operations: Op[] = rolls.map(roll => ({
    op: 'addToInitiative',
    name: roll.name,
    value: roll.value,
    source: 'dm',
    tokenId: roll.tokenId,
  }));
  for (let offset = 0; offset < operations.length; offset += 20) {
    const applied = await callRoom(env, access, 'POST', '/ops', {
      id: crypto.randomUUID(),
      ops: operations.slice(offset, offset + 20),
    });
    if (!applied.ok) return applied;
  }
  return json({ rolls });
}

function isEncounterToken(value: unknown): value is Token {
  return isRecord(value) && (value.kind === 'monster' || value.kind === 'npc') && typeof value.id === 'string'
    && typeof value.name === 'string' && (value.entryId === null || typeof value.entryId === 'string');
}

interface InitiativeSource {
  entryId: string | null;
  modifier?: number;
}

function initiativeSource(token: Token, npcs: readonly NpcRecord[]): InitiativeSource {
  if (token.kind === 'monster') return { entryId: token.entryId };
  const npcId = token.entryId?.startsWith('npc:') ? token.entryId.slice(4) : '';
  const npc = npcId ? npcs.find(record => record.id === npcId) : undefined;
  return npc ? resolveNpcInitiativeSource(npc, npcs) : { entryId: null, modifier: 0 };
}

function isInitiativeNpc(value: unknown): value is NpcRecord {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
    && Array.isArray(value.aliases) && typeof value.role === 'string' && typeof value.location === 'string'
    && typeof value.status === 'string' && typeof value.notesMarkdown === 'string'
    && (value.sourceFile === null || typeof value.sourceFile === 'string') && typeof value.updatedAt === 'number';
}

function rollD20(): number {
  const values = new Uint32Array(1);
  const acceptedRange = 0x1_0000_0000 - (0x1_0000_0000 % 20);
  do crypto.getRandomValues(values); while (values[0] >= acceptedRange);
  return (values[0] % 20) + 1;
}

function asCompendiumIndexRow(value: unknown): CompendiumIndexRow | null {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.id !== 'string' || typeof value.nameZh !== 'string'
    || typeof value.nameEn !== 'string' || typeof value.source !== 'string' || typeof value.bookFile !== 'string') return null;
  return {
    type: value.type,
    id: value.id,
    nameZh: value.nameZh,
    nameEn: value.nameEn,
    source: value.source,
    bookFile: value.bookFile,
    ...(typeof value.cr === 'string' ? { cr: value.cr } : {}),
    ...(typeof value.level === 'number' ? { level: value.level } : {}),
    ...(typeof value.initiativeModifier === 'number' ? { initiativeModifier: value.initiativeModifier } : {}),
    ...(typeof value.hitPoints === 'number' ? { hitPoints: value.hitPoints } : {}),
    ...(typeof value.hasToken === 'boolean' ? { hasToken: value.hasToken } : {}),
  };
}

function isCompendiumType(value: string): boolean {
  return value === 'monster' || value === 'spell' || value === 'item' || value === 'feat' || value === 'condition';
}

function firstObjectArray(value: unknown): unknown[] {
  if (!isRecord(value)) return [];
  for (const candidate of Object.values(value)) if (Array.isArray(candidate)) return candidate;
  return [];
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ?? character);
}

async function writeAudit(env: Env, access: RoomAccess, action: string, targetType: string, targetId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_events
      (id, workspace_id, campaign_id, room_id, actor_user_id, actor_campaign_member_id, actor_room_member_id, action, target_type, target_id, outcome, occurred_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'success', ?11)`,
  ).bind(
    crypto.randomUUID(), access.workspaceId, access.campaignId, access.roomId,
    access.userId, access.campaignMemberId, access.memberId,
    action, targetType, targetId, Date.now(),
  ).run();
}

async function writeInviteAudit(env: Env, userId: string, roomSlug: string): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT c.workspace_id, r.campaign_id, r.id AS room_id
       FROM rooms r JOIN campaigns c ON c.id = r.campaign_id
      WHERE r.slug = ?1`,
  ).bind(roomSlug).first<{ workspace_id: string; campaign_id: string; room_id: string }>();
  if (!row) return;
  await env.DB.prepare(
    `INSERT INTO audit_events (id, workspace_id, campaign_id, room_id, actor_user_id, action, target_type, target_id, outcome, occurred_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'invite.redeem', 'room', ?4, 'success', ?6)`,
  ).bind(crypto.randomUUID(), row.workspace_id, row.campaign_id, row.room_id, userId, Date.now()).run();
}

function expiredSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:';
  return `${secure ? '__Host-dnd-session' : 'dnd_session'}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
