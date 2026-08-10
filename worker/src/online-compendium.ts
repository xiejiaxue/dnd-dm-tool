import { DurableObject } from 'cloudflare:workers';
import type { EntryType } from '../../shared/types';
import { HttpError, isRecord, json } from './http';
import {
  ONLINE_COMPENDIUM_BASE_URL,
  isOnlineDataFileName,
  onlineSearchResults,
  parseOnlineEntryId,
  type OnlineEntryReference,
  type OnlineSearchRequest,
} from './online-compendium-data';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 24;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_BOOK_BYTES = 6 * 1024 * 1024;
const CACHE_TTL_SECONDS = 6 * 60 * 60;
const SEARCH_RESULT_CACHE_TTL_SECONDS = 10 * 60;
const CACHE_NAMESPACE = 'dnd-compendium-online-v1';
const INTERNAL_RATE_LIMIT_HEADER = 'x-dnd-internal-rate-limit';

const ONLINE_SEARCH_INDEX_PATH = 'search/index.json';
const ONLINE_BESTIARY_INDEX_PATH = 'data/bestiary/index.json';
const ONLINE_SPELL_INDEX_PATH = 'data/spells/index.json';

interface RateLimitWindow {
  startedAt: number;
  count: number;
}

/**
 * A short-lived per-visitor sliding window used exclusively before an online
 * compendium request.  It deliberately stores no raw IP address: the Worker
 * routes a SHA-256 digest to an isolated Durable Object instance instead.
 */
export class OnlineCompendiumRateLimitDurableObject extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST' || request.headers.get(INTERNAL_RATE_LIMIT_HEADER) !== '1') {
      return new Response('Not found', { status: 404 });
    }

    const now = Date.now();
    const previous = await this.ctx.storage.get<RateLimitWindow>('window');
    const window = !previous || now - previous.startedAt >= RATE_LIMIT_WINDOW_MS
      ? { startedAt: now, count: 0 }
      : previous;

    if (window.count >= RATE_LIMIT_MAX_REQUESTS) {
      const retryAfter = Math.max(1, Math.ceil((window.startedAt + RATE_LIMIT_WINDOW_MS - now) / 1000));
      return new Response(JSON.stringify({ retryAfter }), {
        status: 429,
        headers: { 'cache-control': 'no-store', 'content-type': 'application/json', 'retry-after': String(retryAfter) },
      });
    }

    window.count += 1;
    await this.ctx.storage.put('window', window);
    // Keep only the active window so an abandoned visitor does not leave a
    // persistent rate-limit record behind.
    await this.ctx.storage.setAlarm(now + RATE_LIMIT_WINDOW_MS * 2);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.delete('window');
  }
}

export async function consumeOnlineLookupBudget(env: Env, request: Request, userId: string): Promise<void> {
  const forwardedIp = request.headers.get('cf-connecting-ip');
  // CF-Connecting-IP is supplied by Cloudflare at the edge.  Local tests and
  // development use the anonymous session identity as a safe fallback.
  const identity = forwardedIp ? `ip:${forwardedIp}` : `session:${userId}`;
  const key = await sha256Hex(identity);
  const response = await env.COMPENDIUM_RATE_LIMIT.getByName(`online-compendium:${key}`).fetch('https://rate-limit/consume', {
    method: 'POST',
    headers: { [INTERNAL_RATE_LIMIT_HEADER]: '1' },
  });
  if (response.status === 429) {
    throw new HttpError(429, 'COMPENDIUM_RATE_LIMITED', '在线资料查询过于频繁，请稍后再试');
  }
  if (!response.ok) {
    console.warn(JSON.stringify({ event: 'compendium_rate_limit_unavailable', status: response.status }));
    throw new HttpError(503, 'COMPENDIUM_UNAVAILABLE', '在线资料服务暂时不可用');
  }
}

export async function searchOnlineCompendium(ctx: ExecutionContext, request: OnlineSearchRequest): Promise<Response> {
  if (!request.query) return json([]);
  const cache = await caches.open(CACHE_NAMESPACE);
  const resultCacheKey = onlineSearchResultCacheKey(request);
  const cachedResult = await cache.match(resultCacheKey);
  if (cachedResult) {
    try {
      return json(await readJsonBody(cachedResult, 64 * 1024), {
        headers: { 'x-compendium-source': '5etools-cn-online' },
      });
    } catch {
      ctx.waitUntil(cache.delete(resultCacheKey).catch(() => {
        console.warn(JSON.stringify({ event: 'compendium_search_cache_delete_failed' }));
      }));
    }
  }
  const index = await loadOnlineJson(ctx, ONLINE_SEARCH_INDEX_PATH, MAX_INDEX_BYTES);
  const results = onlineSearchResults(index, request);
  const response = new Response(JSON.stringify(results), {
    headers: {
      'cache-control': `public, max-age=${SEARCH_RESULT_CACHE_TTL_SECONDS}`,
      'content-type': 'application/json; charset=utf-8',
    },
  });
  ctx.waitUntil(cache.put(resultCacheKey, response).catch(() => {
    console.warn(JSON.stringify({ event: 'compendium_search_cache_write_failed' }));
  }));
  return json(results, {
    headers: { 'x-compendium-source': '5etools-cn-online' },
  });
}

export function onlineEntryReference(type: string, id: string): OnlineEntryReference | null {
  return parseOnlineEntryId(type, id);
}

export async function getOnlineCompendiumEntry(ctx: ExecutionContext, reference: OnlineEntryReference): Promise<Response> {
  const path = await onlineFileForReference(ctx, reference);
  const source = await loadOnlineJson(ctx, path, MAX_BOOK_BYTES);
  const records = recordsForType(source, reference.type);
  const entry = records.find((record) => englishName(record) === reference.nameEn && record.source === reference.source);
  if (!entry) throw new HttpError(404, 'NOT_FOUND', '找不到在线资料条目');
  return json(entry, {
    headers: {
      // Browser responses remain private/no-store through json(); edge cache is
      // used only for the trusted upstream JSON, never for a session response.
      'x-compendium-source': '5etools-cn-online',
    },
  });
}

async function onlineFileForReference(ctx: ExecutionContext, reference: OnlineEntryReference): Promise<string> {
  if (reference.type === 'item') return 'data/items.json';
  if (reference.type === 'feat') return 'data/feats.json';
  if (reference.type === 'condition') return 'data/conditionsdiseases.json';

  const indexPath = reference.type === 'monster' ? ONLINE_BESTIARY_INDEX_PATH : ONLINE_SPELL_INDEX_PATH;
  const sourceIndex = await loadOnlineJson(ctx, indexPath, MAX_INDEX_BYTES);
  if (!isRecord(sourceIndex)) throw new HttpError(503, 'COMPENDIUM_UNAVAILABLE', '在线资料索引格式无效');
  const fileName = sourceIndex[reference.source];
  if (!isOnlineDataFileName(reference.type, fileName)) {
    throw new HttpError(404, 'NOT_FOUND', '找不到在线资料条目');
  }
  return `data/${reference.type === 'monster' ? 'bestiary' : 'spells'}/${fileName}`;
}

async function loadOnlineJson(ctx: ExecutionContext, relativePath: string, maximumBytes: number): Promise<unknown> {
  if (!isWhitelistedOnlinePath(relativePath)) {
    // This is a programmer/configuration error, rather than a client error.
    // Keeping the guard here prevents this module from ever becoming a generic
    // URL proxy when new call sites are added later.
    console.error(JSON.stringify({ event: 'compendium_unapproved_upstream_path' }));
    throw new HttpError(503, 'COMPENDIUM_UNAVAILABLE', '在线资料服务暂时不可用');
  }
  const upstreamUrl = new URL(relativePath, ONLINE_COMPENDIUM_BASE_URL).toString();
  const cacheKey = new Request(upstreamUrl);
  const cache = await caches.open(CACHE_NAMESPACE);
  const cached = await cache.match(cacheKey);
  if (cached) {
    try {
      return await readJsonBody(cached, maximumBytes);
    } catch {
      ctx.waitUntil(cache.delete(cacheKey).catch(() => {
        console.warn(JSON.stringify({ event: 'compendium_cache_delete_failed' }));
      }));
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'GET',
      // Workers does not implement redirect:"error". Manual mode retains the
      // safe property we need: a redirect is never followed to a new target.
      redirect: 'manual',
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'compendium_upstream_fetch_failed',
      reason: error instanceof Error ? error.name : 'unknown',
      // The target is a code constant, not user input, so this bounded detail
      // is safe and makes production upstream failures diagnosable.
      message: error instanceof Error ? error.message.slice(0, 160) : '',
    }));
    throw new HttpError(503, 'COMPENDIUM_UNAVAILABLE', '在线资料服务暂时不可用');
  }
  if (!upstream.ok) {
    console.warn(JSON.stringify({ event: 'compendium_upstream_bad_status', status: upstream.status }));
    throw new HttpError(503, 'COMPENDIUM_UNAVAILABLE', '在线资料服务暂时不可用');
  }

  let payload: unknown;
  try {
    payload = await readJsonBody(upstream, maximumBytes);
  } catch (error) {
    if (!(error instanceof HttpError)) console.warn(JSON.stringify({ event: 'compendium_upstream_invalid_json' }));
    throw error instanceof HttpError ? error : new HttpError(503, 'COMPENDIUM_UNAVAILABLE', '在线资料服务暂时不可用');
  }

  const cachedResponse = new Response(JSON.stringify(payload), {
    headers: {
      'cache-control': `public, max-age=${CACHE_TTL_SECONDS}`,
      'content-type': 'application/json; charset=utf-8',
    },
  });
  ctx.waitUntil(cache.put(cacheKey, cachedResponse).catch(() => {
    console.warn(JSON.stringify({ event: 'compendium_cache_write_failed' }));
  }));
  return payload;
}

async function readJsonBody(response: Response, maximumBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new HttpError(503, 'COMPENDIUM_UNAVAILABLE', '在线资料文件过大');
  }
  if (!response.body) throw new HttpError(503, 'COMPENDIUM_UNAVAILABLE', '在线资料为空');

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
        throw new HttpError(503, 'COMPENDIUM_UNAVAILABLE', '在线资料文件过大');
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
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(503, 'COMPENDIUM_UNAVAILABLE', '在线资料格式无效');
  }
}

function recordsForType(value: unknown, type: EntryType): Record<string, unknown>[] {
  if (!isRecord(value)) throw new HttpError(503, 'COMPENDIUM_UNAVAILABLE', '在线资料格式无效');
  const candidate = value[type];
  if (!Array.isArray(candidate)) throw new HttpError(503, 'COMPENDIUM_UNAVAILABLE', '在线资料格式无效');
  return candidate.filter(isRecord);
}

function englishName(value: Record<string, unknown>): string | null {
  if (typeof value.ENG_name === 'string') return value.ENG_name;
  return typeof value.name === 'string' ? value.name : null;
}

function isWhitelistedOnlinePath(path: string): boolean {
  return path === ONLINE_SEARCH_INDEX_PATH
    || path === ONLINE_BESTIARY_INDEX_PATH
    || path === ONLINE_SPELL_INDEX_PATH
    || path === 'data/items.json'
    || path === 'data/feats.json'
    || path === 'data/conditionsdiseases.json'
    || /^data\/bestiary\/bestiary-[a-z0-9-]+\.json$/u.test(path)
    || /^data\/spells\/spells-[a-z0-9-]+\.json$/u.test(path);
}

function onlineSearchResultCacheKey(request: OnlineSearchRequest): Request {
  const key = new URL(ONLINE_SEARCH_INDEX_PATH, ONLINE_COMPENDIUM_BASE_URL);
  // This URL is a Cache API key only; it is never used with fetch(). Its fixed
  // origin and bounded values keep user input out of all upstream routing.
  key.searchParams.set('dnd-query', request.query.toLocaleLowerCase('zh-Hans-CN'));
  key.searchParams.set('dnd-type', request.type);
  return new Request(key.toString());
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
