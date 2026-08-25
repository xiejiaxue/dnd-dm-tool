import { api } from '../../api';
import { formatMonster, type StatBlock } from '../../format';
import type { NpcRecord } from '../../types';
import { monsterHitPoints } from '../../../../shared/compendium';
import { normalizeNpcMetadata, npcImportanceRank, npcMaximumHitPoints, sortNpcRecords } from '../../../../shared/npc-metadata';

export interface NpcTreeFolder {
  type: 'folder';
  key: string;
  name: string;
  count: number;
  children: NpcTreeNode[];
}

export interface NpcTreeLeaf {
  type: 'npc';
  key: string;
  npc: NpcRecord;
}

export type NpcTreeNode = NpcTreeFolder | NpcTreeLeaf;

export interface ResolvedNpcData {
  stat: StatBlock;
  avatar: string;
  hitPoints?: number;
  sourceLabel: string;
}

const entryRequests = new Map<string, Promise<any>>();

/** Build exactly two visual levels: one faction folder and one NPC file. */
export function buildNpcTree(records: readonly NpcRecord[]): NpcTreeNode[] {
  const factions = new Map<string, NpcTreeFolder>();
  for (const source of sortNpcRecords(records)) {
    const npc = normalizeNpcMetadata(source);
    const faction = npc.faction || '未分类';
    let folder = factions.get(faction);
    if (!folder) {
      folder = { type: 'folder', key: `/${faction}`, name: faction, count: 0, children: [] };
      factions.set(faction, folder);
    }
    folder.count += 1;
    folder.children.push({ type: 'npc', key: npc.id, npc });
  }
  return [...factions.values()].sort((left, right) => {
    const leftRank = Math.min(...left.children.map(child => child.type === 'npc' ? npcImportanceRank(child.npc.importance) : 2));
    const rightRank = Math.min(...right.children.map(child => child.type === 'npc' ? npcImportanceRank(child.npc.importance) : 2));
    return leftRank - rightRank || left.name.localeCompare(right.name, 'zh-Hans-CN', { numeric: true });
  });
}

export function searchNpcs(records: readonly NpcRecord[], query: string): NpcRecord[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return sortNpcRecords(records).map(normalizeNpcMetadata);
  return sortNpcRecords(records.map(normalizeNpcMetadata).filter(npc => [
    npc.name,
    ...npc.aliases,
    npc.role,
    npc.location,
    npc.faction ?? '',
    ...(npc.groupPath ?? []),
    npc.notesMarkdown,
  ].some(value => value.toLocaleLowerCase().includes(needle))));
}

export function formatCustomNpc(npc: NpcRecord): StatBlock {
  const lines = npc.notesMarkdown.replace(/\r\n?/gu, '\n').split('\n');
  const rows: [string, string][] = [];
  const bodyLines: string[] = [];
  let meta = '';
  for (const line of lines) {
    const standaloneBold = /^\s*\*\*(.+?)\*\*\s*$/u.exec(line);
    if (!meta && standaloneBold && !/^(阵营|身份|地点|状态|描述|出处|游戏数据)/u.test(standaloneBold[1])) {
      meta = standaloneBold[1].trim();
      continue;
    }
    const table = /^\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/u.exec(line);
    if (table) {
      const key = table[1].trim();
      const value = table[2].trim();
      if (key !== '属性' && !/^[-:]+$/u.test(key) && !/^[-:]+$/u.test(value)) rows.push([key, value]);
      continue;
    }
    bodyLines.push(line);
  }
  const body = bodyLines.join('\n').split(/\n{2,}/u).map(value => value.trim()).filter(Boolean);
  return {
    name: npc.name,
    meta: meta || [npc.role, npc.faction].filter(Boolean).join(' · ') || '模组 NPC',
    rows,
    body,
  };
}

export async function resolveNpcData(source: NpcRecord, records: readonly NpcRecord[]): Promise<ResolvedNpcData> {
  const npc = normalizeNpcMetadata(source);
  const reference = npc.statReference!;
  if (reference.kind === 'npc') {
    const linked = records.find(candidate => candidate.id === reference.npcId);
    if (linked) {
      const resolved = await resolveNpcData(linked, records);
      return { ...resolved, stat: { ...resolved.stat, name: npc.name }, sourceLabel: `采用 ${reference.name} 的数据` };
    }
  }
  if (reference.kind === 'compendium') {
    try {
      let request = entryRequests.get(reference.entryId);
      if (!request) {
        request = api.entry('monster', reference.entryId);
        entryRequests.set(reference.entryId, request);
      }
      const raw = await request;
      return {
        stat: { ...formatMonster(raw), name: npc.name },
        avatar: `/api/token/${reference.entryId}`,
        hitPoints: monsterHitPoints(raw),
        sourceLabel: `${reference.nameZh} · ${reference.nameEn}`,
      };
    } catch {
      entryRequests.delete(reference.entryId);
    }
  }
  return {
    stat: formatCustomNpc(npc),
    avatar: '',
    hitPoints: npcMaximumHitPoints(npc.notesMarkdown),
    sourceLabel: '模组专属数据',
  };
}
