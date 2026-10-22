import type { NpcRecord, NpcStatus } from '../../types';
import { canonicalizeNpcRecord, normalizeNpcImportance } from '../../../../shared/npc-metadata';

export const MAX_NPC_MARKDOWN_BYTES = 512 * 1024;
export const MAX_IMPORTED_NPCS = 100;

type Fields = Record<string, string>;

const FIELD_ALIASES: Record<string, string[]> = {
  name: ['name', 'npc', '姓名', '名称', '名字'],
  aliases: ['aliases', 'alias', '别名', '化名'],
  role: ['role', 'title', 'identity', '身份', '职业', '头衔', '作用'],
  location: ['location', '地点', '位置', '所在地', '当前地点'],
  status: ['status', '状态'],
  importance: ['importance', 'priority', '重要程度', '重要性', '优先级'],
  faction: ['faction', 'allegiance', '阵营', '势力'],
  groupPath: ['group', 'groups', 'folder', 'path', '分组', '组织', '路径'],
};

function npcId(): string {
  return typeof crypto?.randomUUID === 'function'
    ? `npc-${crypto.randomUUID()}`
    : `npc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cleanHeading(value: string): string {
  return value.replace(/\s+#+\s*$/u, '').replace(/^NPC\s*[:：-]\s*/iu, '').trim().slice(0, 120);
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/gu, '');
}

function readField(fields: Fields, kind: keyof typeof FIELD_ALIASES): string {
  const aliases = new Set(FIELD_ALIASES[kind].map(normalizeKey));
  for (const [key, value] of Object.entries(fields)) {
    if (aliases.has(normalizeKey(key))) return value.trim();
  }
  return '';
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseFrontMatter(source: string): { fields: Fields; body: string } {
  const normalized = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  if (!normalized.startsWith('---\n')) return { fields: {}, body: normalized };
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) return { fields: {}, body: normalized };
  const fields: Fields = {};
  for (const line of normalized.slice(4, end).split('\n')) {
    const match = /^\s*([^:#][^:]*)\s*:\s*(.*?)\s*$/u.exec(line);
    if (match) fields[match[1]] = stripQuotes(match[2]);
  }
  return { fields, body: normalized.slice(end + 5).trim() };
}

function labeledFields(body: string): Fields {
  const fields: Fields = {};
  for (const line of body.split('\n')) {
    const match = /^\s*(?:[-*+]\s*)?(?:\*\*)?([^:*：]{1,20})(?:\*\*)?\s*[:：]\s*(.*?)\s*$/u.exec(line);
    if (match) fields[match[1]] = match[2].replace(/\*\*$/u, '').trim();
  }
  return fields;
}

function aliases(value: string): string[] {
  const unwrapped = value.replace(/^\[|\]$/gu, '');
  return [...new Set(unwrapped.split(/[,，、;|]+/u).map(item => stripQuotes(item)).filter(Boolean))].slice(0, 12);
}

export function npcStatus(value: string): NpcStatus {
  const normalized = value.trim().toLowerCase();
  if (/^(dead|deceased|死亡|已死|阵亡)$/u.test(normalized)) return 'dead';
  if (/^(missing|失踪|下落不明)$/u.test(normalized)) return 'missing';
  if (/^(inactive|retired|离开|退场|非活跃)$/u.test(normalized)) return 'inactive';
  return 'active';
}

function recordFrom(nameHint: string, body: string, sourceFile: string, frontMatter: Fields = {}): NpcRecord | null {
  const fields = { ...labeledFields(body), ...frontMatter };
  const name = cleanHeading(readField(fields, 'name') || nameHint);
  if (!name) return null;
  const faction = readField(fields, 'faction').slice(0, 120);
  const groupPath = readField(fields, 'groupPath').split(/[/>]+/u).map(value => value.trim()).filter(Boolean).slice(0, 6);
  const importance = normalizeNpcImportance(readField(fields, 'importance'));
  return canonicalizeNpcRecord({
    id: npcId(),
    name,
    aliases: aliases(readField(fields, 'aliases')),
    role: readField(fields, 'role').slice(0, 120),
    location: readField(fields, 'location').slice(0, 120),
    status: npcStatus(readField(fields, 'status')),
    importance,
    faction,
    groupPath: [faction || groupPath[0] || '未分类'],
    notesMarkdown: body.trim().slice(0, 16_000),
    sourceFile: sourceFile.slice(0, 180) || null,
    updatedAt: Date.now(),
  });
}

/** Parse one NPC per H1 heading. A front-matter document is intentionally a
 * single record so its lower headings remain part of that NPC's notes. */
export function parseNpcMarkdown(source: string, sourceFile: string): NpcRecord[] {
  const { fields, body } = parseFrontMatter(source);
  const frontMatterName = readField(fields, 'name');
  if (frontMatterName) {
    const record = recordFrom(frontMatterName, body, sourceFile, fields);
    return record ? [record] : [];
  }

  const headings = [...body.matchAll(/^#\s+(.+?)\s*$/gmu)];
  if (headings.length === 0) {
    const fallbackName = sourceFile.replace(/\.(?:md|markdown|mdown)$/iu, '');
    const record = recordFrom(fallbackName, body, sourceFile);
    return record ? [record] : [];
  }

  const identityHeadings = headings.filter(heading => !isArchiveSectionHeading(heading[1]));
  if (identityHeadings.length <= 1 && headings.length > 1) {
    const fallbackName = sourceFile.replace(/\.(?:md|markdown|mdown)$/iu, '');
    const name = identityHeadings[0]?.[1] ?? fallbackName;
    const record = recordFrom(name, body.replace(identityHeadings[0]?.[0] ?? '', '').trim(), sourceFile);
    return record ? [record] : [];
  }

  const records: NpcRecord[] = [];
  for (let index = 0; index < headings.length && records.length < MAX_IMPORTED_NPCS; index += 1) {
    const heading = headings[index];
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? body.length;
    const record = recordFrom(heading[1], body.slice(start, end), sourceFile);
    if (record) records.push(record);
  }
  return records;
}

function isArchiveSectionHeading(value: string): boolean {
  return /^(?:人物档案|人物资料|背景|人物背景|规则资料|规则数据|背景与规则资料|游戏数据|数据|地点|描述)$/u
    .test(cleanHeading(value).replace(/\s+/gu, ''));
}

export function emptyNpc(): NpcRecord {
  return canonicalizeNpcRecord({
    id: npcId(),
    name: '',
    aliases: [],
    role: '',
    location: '',
    status: 'active',
    importance: 'supporting',
    faction: '未分类',
    groupPath: ['未分类'],
    notesMarkdown: '',
    playerAccess: 'none',
    publicDescription: '',
    sourceFile: null,
    updatedAt: Date.now(),
  });
}
