import { DEFAULT_TOKEN_SIZE, type NpcRecord, type Scene, type Token } from '../../types';
import { nextTokenSpawn } from '../../tokenPlacement';
import { normalizeNpcMetadata } from '../../../../shared/npc-metadata';

export function npcTokenColor(status: NpcRecord['status']): string {
  if (status === 'dead') return '#71717a';
  if (status === 'missing') return '#a855f7';
  if (status === 'inactive') return '#64748b';
  return '#0ea5e9';
}

export function npcEntryId(npcId: string): string {
  return `npc:${npcId}`;
}

export function npcIdFromEntryId(entryId: string | null): string | null {
  return entryId?.startsWith('npc:') ? entryId.slice(4) || null : null;
}

/** Resolve both current and legacy NPC tokens. Exact ids win; old tokens that
 * lost their record link during an earlier archive import fall back to the
 * canonical character name or alias so the encounter drawer stays usable. */
export function findNpcForToken(token: Pick<Token, 'kind' | 'entryId' | 'name'>, records: readonly NpcRecord[]): NpcRecord | null {
  if (token.kind !== 'npc') return null;
  const npcId = npcIdFromEntryId(token.entryId);
  const exact = npcId ? records.find(npc => npc.id === npcId) : undefined;
  if (exact) return exact;
  const wanted = normalizedNpcTokenName(token.name);
  if (!wanted) return null;
  return records.map(normalizeNpcMetadata).find(npc =>
    [npc.name, ...npc.aliases].some(value => normalizedNpcTokenName(value) === wanted)) ?? null;
}

/** Every NPC combatant gets a quick-reference target, including tokens from
 * an older room whose archived record was not present when the room was
 * created. Prefer the complete campaign record; the fallback still exposes
 * the token's current combat data instead of hiding the quick-reference key. */
export function npcQuickReferenceForToken(
  token: Pick<Token, 'id' | 'kind' | 'entryId' | 'name' | 'hp'>,
  records: readonly NpcRecord[],
): NpcRecord | null {
  const linked = findNpcForToken(token, records);
  if (linked || token.kind !== 'npc') return linked;
  const hp = token.hp ? `${token.hp.current} / ${token.hp.max}` : '未设置';
  return {
    id: npcIdFromEntryId(token.entryId) ?? `token-${token.id}`,
    name: token.name,
    aliases: [],
    role: '场景 NPC',
    location: '当前场景',
    status: 'active',
    importance: 'supporting',
    faction: '未归档',
    groupPath: ['未归档'],
    statReference: { kind: 'custom' },
    notesMarkdown: `**游戏数据**\n\n| 属性 | 数值 |\n| --- | --- |\n| HP | ${hp} |\n\n该 NPC 来自旧房间 token，尚未关联完整档案。`,
    sourceFile: null,
    updatedAt: 0,
  };
}

function normalizedNpcTokenName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+#?\d+$/u, '').replace(/[\s·•._'’“”"「」『』()（）:/\\-]+/gu, '');
}

export function createNpcToken(
  scene: Scene,
  npc: NpcRecord,
  id: string,
  data: { avatar?: string; hitPoints?: number } = {},
): Token {
  const { x, y } = nextTokenSpawn(scene);
  const maximumHitPoints = data.hitPoints && data.hitPoints > 0 ? Math.round(data.hitPoints) : undefined;
  return {
    id,
    kind: 'npc',
    name: npc.name,
    entryId: npcEntryId(npc.id),
    x,
    y,
    size: DEFAULT_TOKEN_SIZE,
    avatar: data.avatar ?? '',
    color: npcTokenColor(npc.status),
    ...(maximumHitPoints ? { hp: { current: maximumHitPoints, max: maximumHitPoints } } : {}),
  };
}
