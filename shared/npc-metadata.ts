import type { NpcImportance, NpcRecord, NpcStatReference } from './types';

interface CompendiumProfile {
  entryId: string;
  nameZh: string;
  nameEn: string;
  aliases: string[];
}

const COMPENDIUM_PROFILES: CompendiumProfile[] = [
  profile('MM__Adult Gold Dragon', '成年金龙', 'Adult Gold Dragon', 'adult gold dragon', '成年金龙'),
  profile('MM__Drow Elite Warrior', '卓尔精英武者', 'Drow Elite Warrior', 'drow elite warrior', '卓尔精英武者'),
  profile('WDH__Drow Gunslinger', '卓尔火枪手', 'Drow Gunslinger', 'drow gunslinger', '卓尔火枪手'),
  profile('VGM__Swashbuckler', '游荡剑者', 'Swashbuckler', 'swashbuckler', '游荡剑者', '剑客'),
  profile('VGM__Martial Arts Adept', '武术高手', 'Martial Arts Adept', 'martial arts adept', '武术高手'),
  profile('VGM__Apprentice Wizard', '学徒法师', 'Apprentice Wizard', 'apprentice wizard', '学徒法师', '学徒'),
  profile('WDH__Nimblewright', '灵巧莱特', 'Nimblewright', 'nimblewright', '灵巧莱特', '秘偶'),
  profile('MM__Bandit Captain', '强盗首领', 'Bandit Captain', 'bandit captain', '强盗首领', '匪帮队长'),
  profile('MM__Mind Flayer', '夺心魔', 'Mind Flayer', 'mind flayer', '夺心魔', '灵吸怪'),
  profile('MM__Drow Mage', '卓尔法师', 'Drow Mage', 'drow mage', '卓尔法师'),
  profile('MM__Chain Devil', '链魔', 'Chain Devil', 'chain devil', '链魔'),
  profile('MM__Beholder', '眼魔', 'Beholder', 'beholder', '眼魔'),
  profile('MM__Duergar', '灰矮人', 'Duergar', 'duergar', '灰矮人'),
  profile('MM__Goblin', '地精', 'Goblin', 'goblin', '地精'),
  profile('MM__Drow', '卓尔', 'Drow', 'drow', '卓尔'),
  profile('MM__Quipper', '食人鱼', 'Quipper', 'quipper', '宠物鱼', '鱼'),
  profile('MM__Draft Horse', '驮马', 'Draft Horse', 'draft horse', '驮用母马', '驮马'),
  profile('MM__Cat', '猫', 'Cat', 'cat', '猫'),
  profile('MM__Archmage', '大法师', 'Archmage', 'archmage', '大法师'),
  profile('MM__Assassin', '刺客', 'Assassin', 'assassin', '刺客'),
  profile('MM__Veteran', '老兵', 'Veteran', 'veteran', 'veterans', '老兵'),
  profile('MM__Commoner', '平民', 'Commoner', 'commoner', '平民'),
  profile('MM__Noble', '贵族', 'Noble', 'noble', '贵族'),
  profile('MM__Cultist', '邪教徒', 'Cultist', 'cultist', '邪教徒'),
  profile('MM__Gladiator', '角斗士', 'Gladiator', 'gladiator', '角斗士'),
  profile('MM__Berserker', '狂战士', 'Berserker', 'berserker', '狂战士'),
  profile('MM__Priest', '祭司', 'Priest', 'priest', '祭司'),
  profile('MM__Knight', '骑士', 'Knight', 'knight', 'knights', '骑士'),
  profile('MM__Thug', '暴徒', 'Thug', 'thug', '暴徒', '佣兵'),
  profile('MM__Guard', '警卫', 'Guard', 'guard', 'guards', '警卫', '守卫'),
  profile('MM__Mage', '魔法师', 'Mage', 'mage', '魔法师', '法师'),
  profile('MM__Druid', '德鲁伊', 'Druid', 'druid', '德鲁伊'),
  profile('MM__Spy', '间谍', 'Spy', 'spy', '间谍', '密探'),
  profile('MM__Scout', '斥候', 'Scout', 'scout', '斥候', '侦察兵'),
  profile('MM__Bandit', '强盗', 'Bandit', 'bandit', '强盗'),
];

const DEFAULT_PROFILE = COMPENDIUM_PROFILES.find(item => item.entryId === 'MM__Commoner')!;

const IMPORTANCE_RANK: Record<NpcImportance, number> = {
  major: 0,
  supporting: 1,
  minor: 2,
};

const IMPORTANCE_LABEL: Record<NpcImportance, string> = {
  major: '主要人物',
  supporting: '重要配角',
  minor: '次要人物',
};

const STATUS_LABEL: Record<NpcRecord['status'], string> = {
  active: '活跃',
  missing: '失踪',
  inactive: '退场',
  dead: '死亡',
};

const LEGACY_SECTION_TITLES = new Set([
  '人物档案', '人物资料', '背景', '人物背景', '规则资料', '规则数据',
  '背景与规则资料', '游戏数据', '数据', '地点', '描述',
]);

function profile(entryId: string, nameZh: string, nameEn: string, ...aliases: string[]): CompendiumProfile {
  return { entryId, nameZh, nameEn, aliases };
}

export function npcImportanceRank(value: NpcImportance | undefined): number {
  return IMPORTANCE_RANK[value ?? 'supporting'];
}

export function npcImportanceLabel(value: NpcImportance | undefined): string {
  return IMPORTANCE_LABEL[value ?? 'supporting'];
}

export function normalizeNpcImportance(value: unknown): NpcImportance | undefined {
  if (value === 'major' || value === 'supporting' || value === 'minor') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLocaleLowerCase();
  if (/^(major|main|primary|主要|核心|主角|关键)$/u.test(normalized)) return 'major';
  if (/^(minor|background|次要|普通|背景)$/u.test(normalized)) return 'minor';
  if (/^(supporting|secondary|重要|配角|重要配角)$/u.test(normalized)) return 'supporting';
  return undefined;
}

export function inferNpcImportance(npc: Pick<NpcRecord, 'name' | 'role' | 'notesMarkdown' | 'importance'>): NpcImportance {
  const explicit = normalizeNpcImportance(npc.importance)
    ?? normalizeNpcImportance(npcLabeledField(npc.notesMarkdown, '重要程度'));
  if (explicit) return explicit;
  const identity = npcLabeledField(npc.notesMarkdown, '身份');
  const searchable = `${npc.name}\n${npc.role}\n${identity}`;
  if (/首领|创始人|领主|掌权|统治者|最终反派|主要反派|核心人物|关键人物|大法师|公开领主|黑杖|公会之主/u.test(searchable)) return 'major';
  if (/普通成员|普通人|平民|仆人|侍从|守卫|卫兵|士兵|学徒|宠物|囚徒|俘虏|信使|跟班|雇员|次要人物/u.test(searchable)) return 'minor';
  return 'supporting';
}

export function stripNpcOrderingPrefix(value: string): string {
  return value.trim().replace(/^\d+[\s._-]*/u, '').trim();
}

export function npcLabeledField(markdown: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`^\\s*(?:[-*+]\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*[:：]\\s*(.*?)\\s*$`, 'imu').exec(markdown);
  return match?.[1]?.replace(/\*\*\s*$/u, '').trim() ?? '';
}

export function npcPathFromSource(sourceFile: string | null | undefined): string[] {
  if (!sourceFile) return [];
  const clean = sourceFile.split('#', 1)[0].replace(/\\/gu, '/');
  const parts = clean.split('/').slice(0, -1).map(stripNpcOrderingPrefix).filter(Boolean);
  return parts.slice(0, 6).map(part => part.slice(0, 80));
}

export function npcHasCustomStatBlock(markdown: string): boolean {
  return /\|\s*护甲等级\s*\|/u.test(markdown) && /\|\s*生命值\s*\|/u.test(markdown);
}

export function deriveNpcStatReference(npc: Pick<NpcRecord, 'role' | 'notesMarkdown'>): NpcStatReference {
  if (npcHasCustomStatBlock(npc.notesMarkdown)) return { kind: 'custom' };
  const rulesSection = npc.notesMarkdown.split(/^\s*(?:\*\*)?描述(?:\*\*)?\s*[:：]/imu, 1)[0];
  const searchable = `${rulesSection}\n${npc.role}`.toLocaleLowerCase();
  const match = COMPENDIUM_PROFILES.find(item => item.aliases.some(alias => searchable.includes(alias.toLocaleLowerCase())));
  const selected = match ?? DEFAULT_PROFILE;
  return {
    kind: 'compendium',
    entryId: selected.entryId,
    nameZh: selected.nameZh,
    nameEn: selected.nameEn,
  };
}

export function normalizeNpcMetadata(npc: NpcRecord): NpcRecord {
  const headingIdentity = splitNpcHeading(npc.name);
  const normalizedIdentity = headingIdentity.length === 1 ? headingIdentity[0] : { name: npc.name, aliases: [] };
  const sourcePath = npcPathFromSource(npc.sourceFile);
  const explicitPath = Array.isArray(npc.groupPath)
    ? npc.groupPath.map(value => value.trim()).filter(Boolean)
    : [];
  const labeledFaction = npcLabeledField(npc.notesMarkdown, '阵营')
    || npcLabeledField(npc.notesMarkdown, '阵营/归属');
  const faction = (npc.faction?.trim() || explicitPath[0] || sourcePath[0] || labeledFaction || '未分类').slice(0, 120);
  const identity = npcLabeledField(npc.notesMarkdown, '身份');
  const role = (!npc.role.trim() || npc.role.trim() === sourcePath[0]) && identity ? identity.slice(0, 120) : npc.role;
  const importance = inferNpcImportance({ ...npc, name: normalizedIdentity.name, role });
  return {
    ...npc,
    name: normalizedIdentity.name,
    aliases: npc.aliases.length > 0 ? npc.aliases : normalizedIdentity.aliases,
    role,
    importance,
    faction,
    // The archive intentionally has exactly two visual levels: faction and
    // one character file. Older sub-organization paths remain searchable in
    // the canonical Markdown body after consolidation, not in the explorer.
    groupPath: [faction],
    statReference: npc.statReference ?? deriveNpcStatReference({ ...npc, role }),
  };
}

export interface ConsolidatedNpcRecords {
  records: NpcRecord[];
  /** Every legacy or duplicate id points at the surviving single-file record. */
  idRemap: Map<string, string>;
}

interface NpcMergeCandidate {
  record: NpcRecord;
  sourceIds: string[];
  fragmentLabel: string | null;
}

/** Convert arbitrary legacy NPC archives into one deterministic record per
 * faction/person. This fixes rooms where Markdown section headings such as
 * “人物档案 / 背景 / 规则资料” were accidentally stored as separate NPCs. */
export function consolidateNpcRecords(sourceRecords: readonly NpcRecord[]): ConsolidatedNpcRecords {
  const candidates: NpcMergeCandidate[] = [];
  for (const source of sourceRecords) {
    const fragmentLabel = legacySectionTitle(source.name);
    const inferredName = fragmentLabel ? legacyPersonName(source) : '';
    const prepared = inferredName ? { ...source, name: inferredName } : source;
    const expanded = fragmentLabel ? [normalizeNpcMetadata(prepared)] : expandNpcRecord(prepared);
    expanded.forEach((record, index) => candidates.push({
      record,
      sourceIds: index === 0 ? [source.id] : [],
      fragmentLabel: inferredName ? fragmentLabel : null,
    }));
  }

  const groups = new Map<string, NpcMergeCandidate[]>();
  for (const candidate of candidates) {
    const npc = normalizeNpcMetadata(candidate.record);
    const key = `${normalizedNpcIdentity(npc.faction ?? '未分类')}\u0000${normalizedNpcIdentity(npc.name)}`;
    const group = groups.get(key) ?? [];
    group.push({ ...candidate, record: npc });
    groups.set(key, group);
  }

  const idRemap = new Map<string, string>();
  const records: NpcRecord[] = [];
  for (const group of groups.values()) {
    const merged = mergeNpcCandidates(group);
    records.push(merged);
    for (const candidate of group) {
      idRemap.set(candidate.record.id, merged.id);
      for (const sourceId of candidate.sourceIds) idRemap.set(sourceId, merged.id);
    }
  }

  const byId = new Map(records.map(record => [record.id, record]));
  for (const record of records) {
    if (record.statReference?.kind !== 'npc') continue;
    const mappedId = idRemap.get(record.statReference.npcId) ?? record.statReference.npcId;
    const target = byId.get(mappedId);
    record.statReference = {
      kind: 'npc',
      npcId: mappedId,
      name: target?.name ?? record.statReference.name,
    };
  }
  return { records: sortNpcRecords(records).slice(0, 250), idRemap };
}

/** Canonicalize one editor/import record without expanding or merging it. */
export function canonicalizeNpcRecord(source: NpcRecord): NpcRecord {
  const normalized = normalizeNpcMetadata(source);
  const importance = inferNpcImportance(normalized);
  const notesMarkdown = canonicalNpcNotes({ ...normalized, importance }, npcArchiveBody(normalized.notesMarkdown));
  const statReference = npcHasCustomStatBlock(notesMarkdown)
    ? { kind: 'custom' as const }
    : normalized.statReference ?? deriveNpcStatReference({ ...normalized, notesMarkdown });
  return {
    ...normalized,
    importance,
    groupPath: [normalized.faction ?? '未分类'],
    statReference,
    notesMarkdown,
  };
}

export function sortNpcRecords(records: readonly NpcRecord[]): NpcRecord[] {
  return [...records].sort((leftSource, rightSource) => {
    const left = normalizeNpcMetadata(leftSource);
    const right = normalizeNpcMetadata(rightSource);
    const importance = npcImportanceRank(left.importance) - npcImportanceRank(right.importance);
    if (importance !== 0) return importance;
    const faction = (left.faction ?? '未分类').localeCompare(right.faction ?? '未分类', 'zh-Hans-CN', { numeric: true });
    if (faction !== 0) return faction;
    return left.name.localeCompare(right.name, 'zh-Hans-CN', { numeric: true });
  });
}

function mergeNpcCandidates(group: readonly NpcMergeCandidate[]): NpcRecord {
  const ordered = [...group].sort((left, right) => npcCandidateQuality(right) - npcCandidateQuality(left));
  const primary = ordered[0].record;
  const faction = primary.faction ?? '未分类';
  const aliases = [...new Set(ordered.flatMap(({ record }) => record.aliases)
    .map(value => value.trim()).filter(Boolean))].slice(0, 12);
  const role = bestNpcText(ordered.map(({ record }) => record.role), primary.name, faction);
  const location = bestNpcText(ordered.map(({ record }) => record.location), primary.name, faction);
  const status = ordered.map(({ record }) => record.status)
    .sort((left, right) => npcStatusRank(right) - npcStatusRank(left))[0] ?? 'active';
  const importance = ordered.map(({ record }) => inferNpcImportance(record))
    .sort((left, right) => npcImportanceRank(left) - npcImportanceRank(right))[0] ?? 'supporting';

  const bodyParts: string[] = [];
  const bodyKeys = new Set<string>();
  for (const candidate of ordered) {
    const body = npcArchiveBody(candidate.record.notesMarkdown);
    if (!body) continue;
    const key = body.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
    if (!key || bodyKeys.has(key)) continue;
    bodyKeys.add(key);
    bodyParts.push(candidate.fragmentLabel ? `### ${candidate.fragmentLabel}\n\n${body}` : body);
  }

  const mergedBase: NpcRecord = {
    ...primary,
    aliases,
    role,
    location,
    status,
    importance,
    faction,
    groupPath: [faction],
    notesMarkdown: bodyParts.join('\n\n'),
    sourceFile: ordered.find(candidate => !candidate.fragmentLabel && candidate.record.sourceFile)?.record.sourceFile
      ?? primary.sourceFile,
    updatedAt: Math.max(...ordered.map(({ record }) => record.updatedAt || 0)),
  };
  const preferredReference = ordered.map(({ record }) => record.statReference).find(reference =>
    reference?.kind === 'custom'
    || reference?.kind === 'npc'
    || (reference?.kind === 'compendium' && reference.entryId !== DEFAULT_PROFILE.entryId))
    ?? primary.statReference;
  return canonicalizeNpcRecord({ ...mergedBase, statReference: preferredReference });
}

function canonicalNpcNotes(npc: NpcRecord, body: string): string {
  const fields = [
    `- **身份**：${npc.role || '未注明'}`,
    `- **阵营/归属**：${npc.faction ?? '未分类'}`,
    `- **重要程度**：${npcImportanceLabel(npc.importance)}`,
    `- **地点**：${npc.location || '未注明'}`,
    `- **状态**：${STATUS_LABEL[npc.status]}`,
    ...(npc.aliases.length > 0 ? [`- **别名**：${npc.aliases.join('、')}`] : []),
  ];
  const prefix = `## 人物档案\n\n${fields.join('\n')}\n\n## 背景与规则资料\n\n`;
  const fallback = body.trim() || '暂无补充资料。';
  return `${prefix}${fallback.slice(0, Math.max(0, 16_000 - prefix.length))}`;
}

function npcArchiveBody(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/gu, '\n').trim();
  const marker = /^##\s+背景与规则资料\s*$/mu.exec(normalized);
  if (marker) return normalized.slice((marker.index ?? 0) + marker[0].length).trim();
  return normalized.replace(/^#\s+[^\n]+\n+/u, '').trim();
}

function legacySectionTitle(value: string): string | null {
  const clean = stripNpcOrderingPrefix(value).replace(/\s+/gu, '');
  return LEGACY_SECTION_TITLES.has(clean) ? clean : null;
}

function legacyPersonName(npc: NpcRecord): string {
  const faction = npc.faction?.trim() ?? '';
  const groupPath = Array.isArray(npc.groupPath) ? npc.groupPath : [];
  const groupedCandidates = groupPath
    .map(stripNpcOrderingPrefix)
    .filter(value => value && value !== faction && !legacySectionTitle(value));
  if (groupedCandidates.length > 0) return groupedCandidates.at(-1)?.slice(0, 120) ?? '';
  const sourceCandidates = npcPathFromSource(npc.sourceFile)
    .map(stripNpcOrderingPrefix)
    .filter(value => value && value !== faction && !legacySectionTitle(value));
  return sourceCandidates.at(-1)?.slice(0, 120) ?? '';
}

function normalizedNpcIdentity(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s·•._'’“”"「」『』()（）:/\\-]+/gu, '');
}

function npcCandidateQuality(candidate: NpcMergeCandidate): number {
  const npc = candidate.record;
  let score = candidate.fragmentLabel ? 0 : 100;
  if (npcHasCustomStatBlock(npc.notesMarkdown) || npc.statReference?.kind === 'custom') score += 50;
  if (npc.statReference?.kind === 'npc' || (npc.statReference?.kind === 'compendium' && npc.statReference.entryId !== DEFAULT_PROFILE.entryId)) score += 25;
  if (npc.role) score += 5;
  if (npc.location) score += 3;
  score += Math.min(20, Math.floor(npc.notesMarkdown.length / 500));
  return score;
}

function bestNpcText(values: readonly string[], name: string, faction: string): string {
  return [...new Set(values.map(value => value.trim()).filter(value => value && value !== name && value !== faction))]
    .sort((left, right) => right.length - left.length)[0]?.slice(0, 120) ?? '';
}

function npcStatusRank(status: NpcRecord['status']): number {
  return status === 'dead' ? 3 : status === 'missing' ? 2 : status === 'inactive' ? 1 : 0;
}

export function npcMaximumHitPoints(markdown: string): number | undefined {
  const table = /^\s*\|\s*生命值\s*\|\s*(\d{1,6})/imu.exec(markdown);
  if (table) return Number(table[1]);
  const prose = /生命值\s*(?:为|[:：])?\s*(\d{1,6})/u.exec(markdown);
  return prose ? Number(prose[1]) : undefined;
}

/** Read a module-specific NPC's Dexterity from its Markdown stat table. NPCs
 * linked to a compendium entry use that entry's initiative metadata instead. */
export function npcInitiativeModifier(markdown: string): number {
  for (const line of markdown.replace(/\r\n?/gu, '\n').split('\n')) {
    const table = /^\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/u.exec(line);
    if (!table) continue;
    const labels = table[1].split(/[\/／]/u).map(value => value.trim().toLocaleLowerCase());
    const dexterityIndex = labels.findIndex(label => label === '敏捷' || label === 'dex' || label === 'dexterity');
    if (dexterityIndex < 0) continue;
    const values = table[2].split(/[\/／]/u).map(value => value.trim());
    const segment = values[dexterityIndex] ?? (labels.length === 1 ? table[2] : '');
    const score = /-?\d{1,3}/u.exec(segment)?.[0];
    if (!score) continue;
    return clampInitiativeModifier(Math.floor((Number(score) - 10) / 2));
  }
  return 0;
}

export interface NpcInitiativeSource {
  entryId: string | null;
  modifier?: number;
}

/** Resolve linked NPC records until initiative ultimately comes from either a
 * compendium monster or one module-specific Dexterity score. */
export function resolveNpcInitiativeSource(npc: NpcRecord, records: readonly NpcRecord[]): NpcInitiativeSource {
  const byId = new Map(records.map(record => [record.id, record]));
  return resolveNpcInitiativeSourceInner(npc, byId, new Set());
}

/** Aggregate module notes such as “其他成员” contain several H2 character
 * profiles. Expand them deterministically so each named character is searchable
 * and can own a token, while preserving the original faction hierarchy. */
export function expandNpcRecord(npc: NpcRecord): NpcRecord[] {
  const headings = [...npc.notesMarkdown.matchAll(/^##\s+(.+?)\s*$/gmu)];
  const sections = headings.flatMap((heading, index) => {
    if (legacySectionTitle(cleanNpcHeading(heading[1]))) return [];
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? npc.notesMarkdown.length;
    const body = npc.notesMarkdown.slice(start, end).trim();
    return npcLabeledField(body, '身份') ? [{ heading: cleanNpcHeading(heading[1]), body }] : [];
  });
  if (sections.length < 2) return [normalizeNpcMetadata(npc)];

  const parent = normalizeNpcMetadata(npc);
  return sections.flatMap(({ heading, body }) => splitNpcHeading(heading).map(({ name, aliases }) => {
    const child: NpcRecord = {
      ...npc,
      id: `${npc.id}-${stableNpcSuffix(`${heading}:${name}`)}`.slice(0, 180),
      name,
      aliases,
      role: npcLabeledField(body, '身份').slice(0, 120),
      location: npcLabeledField(body, '地点').slice(0, 120),
      faction: parent.faction,
      groupPath: [parent.faction ?? '未分类'],
      importance: inferNpcImportance({ ...npc, name, role: npcLabeledField(body, '身份').slice(0, 120), notesMarkdown: body }),
      statReference: undefined,
      notesMarkdown: body.slice(0, 16_000),
      sourceFile: npc.sourceFile ? `${npc.sourceFile.split('#', 1)[0]}#${name}`.slice(0, 180) : null,
    };
    return normalizeNpcMetadata(child);
  }));
}

export function splitNpcHeading(heading: string): { name: string; aliases: string[] }[] {
  const parts = heading.split(/\s*(?:与|、)\s*/u).map(value => value.trim()).filter(Boolean);
  const candidates = parts.length > 1 ? parts : [heading.trim()];
  return candidates.map(value => {
    const split = /^(.*?[\p{Script=Han}）)])\s+([A-Z][A-Za-z0-9 .,'’\-]+)$/u.exec(value);
    return {
      name: (split?.[1] ?? value).trim().slice(0, 120),
      aliases: split?.[2] ? [split[2].trim().slice(0, 80)] : [],
    };
  });
}

function cleanNpcHeading(value: string): string {
  return value.replace(/\s+#+\s*$/u, '').trim();
}

function stableNpcSuffix(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function resolveNpcInitiativeSourceInner(
  npc: NpcRecord,
  records: ReadonlyMap<string, NpcRecord>,
  visited: Set<string>,
): NpcInitiativeSource {
  if (visited.has(npc.id)) return { entryId: null, modifier: npcInitiativeModifier(npc.notesMarkdown) };
  visited.add(npc.id);
  const normalized = normalizeNpcMetadata(npc);
  const reference = normalized.statReference;
  if (reference?.kind === 'compendium') return { entryId: reference.entryId };
  if (reference?.kind === 'npc') {
    const linked = records.get(reference.npcId);
    if (linked) return resolveNpcInitiativeSourceInner(linked, records, visited);
  }
  return { entryId: null, modifier: npcInitiativeModifier(normalized.notesMarkdown) };
}

function clampInitiativeModifier(value: number): number {
  return Number.isFinite(value) ? Math.max(-20, Math.min(30, Math.round(value))) : 0;
}
