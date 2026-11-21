import type { EntryType, IndexEntry } from '../../shared/types';

/**
 * The online fallback is intentionally pinned to one reviewed revision path.
 * No user-controlled URL or repository/path segment ever reaches `fetch()`.
 */
export const ONLINE_COMPENDIUM_BASE_URL = 'https://raw.githubusercontent.com/tjliqy/5etools-cn/cn2.0/';

const ONLINE_ID_PREFIX = 'online:';
const MAX_QUERY_LENGTH = 100;
const MAX_ENTRY_NAME_LENGTH = 180;
const MAX_SOURCE_LENGTH = 64;
const SOURCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/u;

interface OnlineSearchPayload {
  x?: unknown;
  m?: { s?: unknown };
}

export interface OnlineSearchRequest {
  query: string;
  type: EntryType | 'all';
}

export interface OnlineEntryReference {
  type: EntryType;
  source: string;
  nameEn: string;
}

/**
 * 5etools' omniseach index uses numeric category codes. Limit the in-app
 * fallback to the entry categories the tabletop already understands.
 */
const CATEGORY_TO_ENTRY_TYPE: Readonly<Record<number, EntryType>> = {
  1: 'monster',
  2: 'spell',
  4: 'item',
  6: 'condition',
  7: 'feat',
};

export function parseOnlineSearchRequest(url: URL): OnlineSearchRequest {
  const query = (url.searchParams.get('q') ?? '').trim();
  if (!query) return { query: '', type: parseRequestedType(url.searchParams.get('type')) };
  if (query.length > MAX_QUERY_LENGTH) throw new Error('查询关键词过长');
  return { query, type: parseRequestedType(url.searchParams.get('type')) };
}

export function makeOnlineEntryId(type: EntryType, source: string, nameEn: string): string {
  if (!isSafeSource(source) || !isSafeName(nameEn)) throw new Error('在线资料条目格式无效');
  return `${ONLINE_ID_PREFIX}${type}:${source}:${encodeURIComponent(nameEn)}`;
}

export function parseOnlineEntryId(type: string, id: string): OnlineEntryReference | null {
  if (!isEntryType(type) || !id.startsWith(`${ONLINE_ID_PREFIX}${type}:`)) return null;
  const remainder = id.slice(`${ONLINE_ID_PREFIX}${type}:`.length);
  const separator = remainder.indexOf(':');
  if (separator <= 0 || separator === remainder.length - 1) return null;
  const source = remainder.slice(0, separator);
  if (!isSafeSource(source)) return null;
  let nameEn: string;
  try {
    nameEn = decodeURIComponent(remainder.slice(separator + 1));
  } catch {
    return null;
  }
  if (!isSafeName(nameEn)) return null;
  return { type, source, nameEn };
}

export function onlineSearchResults(payload: unknown, request: OnlineSearchRequest): IndexEntry[] {
  if (!request.query) return [];
  const index = asOnlineSearchPayload(payload);
  if (!index || !Array.isArray(index.x)) return [];
  const sourceByIndex = sourceLookup(index.m?.s);
  const normalizedQuery = normalize(request.query);
  const seen = new Set<string>();
  const matches: IndexEntry[] = [];

  for (const value of index.x) {
    const document = asOnlineSearchDocument(value);
    if (!document) continue;
    const type = CATEGORY_TO_ENTRY_TYPE[document.c];
    if (!type || (request.type !== 'all' && request.type !== type)) continue;
    const source = sourceByIndex(document.s);
    if (!source) continue;
    const nameEn = document.n;
    const nameZh = document.cn || nameEn;
    if (!isSafeName(nameEn) || !isSafeName(nameZh)) continue;
    const searchable = normalize(`${nameZh} ${nameEn} ${source}`);
    if (!searchable.includes(normalizedQuery)) continue;

    const id = makeOnlineEntryId(type, source, nameEn);
    if (seen.has(id)) continue;
    seen.add(id);
    matches.push({
      type,
      id,
      nameZh,
      nameEn,
      source,
      // The online lookup resolves a server-side whitelisted source file;
      // this field preserves the shape expected by the existing UI only.
      bookFile: 'online',
      online: true,
    });
  }

  return matches
    .sort((left, right) => scoreMatch(right, normalizedQuery) - scoreMatch(left, normalizedQuery)
      || left.nameZh.localeCompare(right.nameZh, 'zh-Hans-CN'))
    .slice(0, 30);
}

export function isOnlineDataFileName(type: 'monster' | 'spell', fileName: unknown): fileName is string {
  if (typeof fileName !== 'string') return false;
  const prefix = type === 'monster' ? 'bestiary-' : 'spells-';
  return fileName.startsWith(prefix) && /^[a-z0-9-]+\.json$/u.test(fileName);
}

function parseRequestedType(value: string | null): EntryType | 'all' {
  if (value === null || value === '' || value === 'all') return 'all';
  if (isEntryType(value)) return value;
  throw new Error('资料类型无效');
}

function sourceLookup(value: unknown): (sourceIndex: unknown) => string | null {
  if (!isRecord(value)) return () => null;
  const byIndex = new Map<number, string>();
  for (const [source, index] of Object.entries(value)) {
    if (typeof index === 'number' && Number.isInteger(index) && isSafeSource(source)) byIndex.set(index, source);
  }
  return (sourceIndex) => {
    if (typeof sourceIndex === 'string' && isSafeSource(sourceIndex)) return sourceIndex;
    return typeof sourceIndex === 'number' ? byIndex.get(sourceIndex) ?? null : null;
  };
}

function asOnlineSearchPayload(value: unknown): OnlineSearchPayload | null {
  return isRecord(value) ? value as OnlineSearchPayload : null;
}

function asOnlineSearchDocument(value: unknown): { c: number; n: string; cn?: string; s?: unknown } | null {
  if (!isRecord(value) || typeof value.c !== 'number' || typeof value.n !== 'string') return null;
  return {
    c: value.c,
    n: value.n,
    ...(typeof value.cn === 'string' ? { cn: value.cn } : {}),
    ...(Object.hasOwn(value, 's') ? { s: value.s } : {}),
  };
}

function scoreMatch(entry: IndexEntry, query: string): number {
  const zh = normalize(entry.nameZh);
  const en = normalize(entry.nameEn);
  if (zh === query || en === query) return 4;
  if (zh.startsWith(query) || en.startsWith(query)) return 3;
  return 1;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('zh-Hans-CN');
}

function isEntryType(value: string): value is EntryType {
  return ['monster', 'spell', 'item', 'feat', 'condition', 'race', 'subrace', 'background', 'class', 'subclass',
    'classFeature', 'subclassFeature', 'optionalFeature', 'language', 'vehicle', 'action', 'reward'].includes(value);
}

function isSafeSource(value: string): boolean {
  return value.length > 0 && value.length <= MAX_SOURCE_LENGTH && SOURCE_PATTERN.test(value);
}

function isSafeName(value: string): boolean {
  return value.length > 0 && value.length <= MAX_ENTRY_NAME_LENGTH;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
