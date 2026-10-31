import type { ModuleNote } from '../../../../shared/encounter-presets';
import type { FactionQuestBook } from '../../../../shared/faction-quests';
import type { CampaignJournal } from '../../api';
import type { IndexEntry } from '../../types';
import { searchQuests } from '../query/FactionQuests';

/** One row of the global search, already carrying what opening it needs. */
export type SearchHit = { key: string; title: string; subtitle: string; badge?: string } & (
  | { kind: 'scene'; sceneId: string }
  | { kind: 'note'; note: ModuleNote }
  | { kind: 'quest'; chainId: string; questId: string }
  | { kind: 'journal'; journalId: string }
  | { kind: 'entry'; entry: IndexEntry }
);
export type SearchKind = SearchHit['kind'];

/** Display order: what is specific to this table first, then the rulebook. */
export const SEARCH_GROUPS: { kind: SearchKind; label: string }[] = [
  { kind: 'scene', label: '场景' },
  { kind: 'note', label: '模组笔记' },
  { kind: 'quest', label: '派系任务' },
  { kind: 'journal', label: '战役日志' },
  { kind: 'entry', label: '规则与数据卡' },
];

const LIMITS: Record<SearchKind, number> = { scene: 6, note: 12, quest: 8, journal: 8, entry: 20 };

/** How the shortcut reads on this keyboard. */
export const SEARCH_SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform) ? '⌘K' : 'Ctrl K';

export function queryWords(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
}

const includesAll = (text: string, words: readonly string[]) => {
  const haystack = text.toLocaleLowerCase();
  return words.every(word => haystack.includes(word));
};

/** A single line of `text` around the first word it contains, for result subtitles. */
export function snippet(text: string, words: readonly string[], radius = 36): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  const lower = flat.toLocaleLowerCase();
  const at = words.map(word => lower.indexOf(word)).filter(index => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + radius * 2);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/** Items whose titles hold more of the words first; ties keep their original order. */
function titleFirst<T>(items: T[], title: (item: T) => string, words: readonly string[]): T[] {
  const score = (item: T) => { const text = title(item).toLocaleLowerCase(); return words.filter(word => text.includes(word)).length; };
  return items.map(item => ({ item, score: score(item) })).sort((a, b) => b.score - a.score).map(({ item }) => item);
}

export function sceneHits(scenes: { id: string; name: string }[], words: readonly string[]): SearchHit[] {
  if (!words.length) return [];
  return scenes.filter(scene => includesAll(scene.name, words)).slice(0, LIMITS.scene)
    .map(scene => ({ kind: 'scene', key: `scene:${scene.id}`, title: scene.name, subtitle: '切换到此场景', sceneId: scene.id }));
}

export function noteHits(notes: ModuleNote[], words: readonly string[]): SearchHit[] {
  return notes.slice(0, LIMITS.note).map(note => ({
    kind: 'note', key: `note:${note.id}`, title: note.title,
    subtitle: `${note.sceneName} · ${snippet(note.text, words)}`,
    badge: note.kind === 'area' ? '区域' : '概况', note,
  }));
}

export function questHits(book: FactionQuestBook | null, query: string): SearchHit[] {
  if (!book) return [];
  return searchQuests(book, query).slice(0, LIMITS.quest).map(({ chain, quest }) => ({
    kind: 'quest', key: `quest:${quest.id}`, title: `${quest.code} ${quest.title}`, subtitle: chain.name,
    chainId: chain.id, questId: quest.id,
  }));
}

export function journalHits(journals: CampaignJournal[], words: readonly string[]): SearchHit[] {
  if (!words.length) return [];
  const matches = journals.filter(journal => includesAll(`${journal.title} ${journal.content}`, words));
  return titleFirst(matches, journal => journal.title, words).slice(0, LIMITS.journal).map(journal => ({
    kind: 'journal', key: `journal:${journal.id}`, title: journal.title,
    subtitle: journal.content ? snippet(journal.content, words) : '（空白）',
    badge: journal.visibility === 'players' ? '玩家可见' : '仅 DM', journalId: journal.id,
  }));
}

export function entryHits(entries: IndexEntry[]): SearchHit[] {
  return entries.slice(0, LIMITS.entry).map(entry => ({
    kind: 'entry', key: `entry:${entry.type}:${entry.id}`, title: entry.nameZh,
    subtitle: [entry.nameEn, entry.source].filter(Boolean).join(' · '),
    badge: entry.type === 'monster' ? (entry.cr ? `CR ${entry.cr}` : '怪物') : entry.type === 'spell' ? `${entry.level ?? 0} 环` : ENTRY_LABELS[entry.type],
    entry,
  }));
}

const ENTRY_LABELS: Partial<Record<IndexEntry['type'], string>> = {
  item: '装备', feat: '专长', condition: '状态', race: '种族', subrace: '亚种', background: '背景', class: '职业',
  subclass: '子职', classFeature: '职业特性', subclassFeature: '子职特性', optionalFeature: '可选能力', language: '语言', vehicle: '载具', action: '动作', reward: '奖励',
};

/**
 * Groups that have hits, those with a title naming every word first: searching a name shows its
 * card before notes that merely mention it. Ties keep the SEARCH_GROUPS order.
 */
export function groupOrder(hits: SearchHit[], words: readonly string[]): typeof SEARCH_GROUPS {
  const named = (kind: SearchKind) => hits.some(hit => hit.kind === kind && includesAll(hit.title, words));
  const present = SEARCH_GROUPS.filter(group => hits.some(hit => hit.kind === group.kind));
  return [...present.filter(group => named(group.kind)), ...present.filter(group => !named(group.kind))];
}

/** Hits in display order, so arrow keys walk the list exactly as it is drawn. */
export function orderHits(hits: SearchHit[], words: readonly string[]): SearchHit[] {
  return groupOrder(hits, words).flatMap(group => hits.filter(hit => hit.kind === group.kind));
}
