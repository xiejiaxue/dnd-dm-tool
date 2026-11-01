import type { Op } from '../../shared/types';
import type { PersistedRoomState } from './domain';

/**
 * The DM's undo history stores, for each board command, the parts of the scene
 * and campaign it changed as they were before. Undoing restores only those
 * parts, so a player's later move of another token survives an undo.
 */

/** A field's value before the change; no `value` key means the field was absent. */
type Prior = { value?: unknown };
type KeyedList = 'tokens' | 'players' | 'notes';
const KEYED: readonly KeyedList[] = ['tokens', 'players', 'notes'];
// Music and handouts are live table controls, not board edits; identity fields never change through ops.
const CAMPAIGN_SKIP = new Set(['id', 'name', 'sceneIds', 'music', 'handouts', 'shownHandoutId']);
/** Fog strokes and wall clearing arrive as many commands; one undo takes back the whole gesture. */
const COALESCING = new Set(['修改迷雾', '删墙']);
const COALESCE_MS = 2_000;
export const UNDO_DEPTH = 30;

export interface UndoEntry {
  sceneId: string;
  label: string;
  at: number;
  scene: Record<string, Prior>;
  /** Items of id-keyed lists before the change, with their index for re-insertion (-1 = was absent). */
  items: Partial<Record<KeyedList, Record<string, Prior & { index: number }>>>;
  campaign: Record<string, Prior>;
}

const LABELS: Record<Op['op'], string | null> = {
  moveToken: '移动棋子', addToken: '放置棋子', removeToken: '删除棋子', updateToken: '修改棋子',
  addPlayer: '修改玩家棋子', removePlayer: '移除玩家棋子', updatePlayer: '修改玩家棋子',
  addWall: '画墙', removeWall: '删墙', updateGrid: '调整网格', updateMap: '更换地图', updateMapScale: '缩放地图',
  addEnemy: '修改遭遇列表', removeEnemy: '修改遭遇列表', setQuestStatus: '修改派系任务', setFactionNote: '修改派系任务',
  switchCampaign: null, submitInitiative: '修改先攻', addToInitiative: '修改先攻', removeFromInitiative: '修改先攻',
  advanceTurn: '下一回合', previousTurn: '上一回合', reorderInitiative: '修改先攻',
  addFavorite: '修改收藏', removeFavorite: '修改收藏',
  setFog: '修改迷雾', revealFogRect: '修改迷雾', revealAllFog: '修改迷雾', coverAllFog: '修改迷雾',
  addMapNote: '添加地图笔记', updateMapNote: '修改地图笔记', removeMapNote: '删除地图笔记',
  setMusic: null, showHandout: null, hideHandout: null, removeHandout: null,
};

/** What the command did, in words; null when nothing in it is undoable. */
export function undoLabel(operations: readonly Op[]): string | null {
  for (const operation of operations) {
    const label = LABELS[operation.op];
    if (label) return label;
  }
  return null;
}

export function captureUndo(prior: PersistedRoomState, next: PersistedRoomState, label: string, at: number): UndoEntry | null {
  const sceneId = prior.currentSceneId;
  const before = prior.scenes[sceneId] as unknown as Record<string, unknown> | undefined;
  const after = next.scenes[sceneId] as unknown as Record<string, unknown> | undefined;
  if (!before || !after) return null;
  const entry: UndoEntry = { sceneId, label, at, scene: {}, items: {}, campaign: {} };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === 'id' || (KEYED as readonly string[]).includes(key)) continue;
    if (!same(before[key], after[key])) entry.scene[key] = priorOf(before, key);
  }
  for (const list of KEYED) {
    const old = (before[list] as Array<{ id: string }> | undefined) ?? [];
    const now = (after[list] as Array<{ id: string }> | undefined) ?? [];
    const oldById = new Map(old.map((item, index) => [item.id, { item, index }]));
    const nowById = new Map(now.map((item) => [item.id, item]));
    const changed: Record<string, Prior & { index: number }> = {};
    for (const id of new Set([...oldById.keys(), ...nowById.keys()])) {
      const was = oldById.get(id);
      if (same(was?.item, nowById.get(id))) continue;
      changed[id] = was ? { value: structuredClone(was.item), index: was.index } : { index: -1 };
    }
    if (Object.keys(changed).length) entry.items[list] = changed;
  }
  if (prior.campaign !== next.campaign) {
    const oldCampaign = prior.campaign as unknown as Record<string, unknown>;
    const newCampaign = next.campaign as unknown as Record<string, unknown>;
    for (const key of new Set([...Object.keys(oldCampaign), ...Object.keys(newCampaign)])) {
      if (!CAMPAIGN_SKIP.has(key) && !same(oldCampaign[key], newCampaign[key])) entry.campaign[key] = priorOf(oldCampaign, key);
    }
  }
  const empty = !Object.keys(entry.scene).length && !Object.keys(entry.items).length && !Object.keys(entry.campaign).length;
  return empty ? null : entry;
}

/** Folds a newer step of the same gesture into the older entry, keeping each part's earliest value. */
export function mergeUndo(older: UndoEntry, newer: UndoEntry): UndoEntry | null {
  if (older.sceneId !== newer.sceneId || older.label !== newer.label || !COALESCING.has(newer.label) || newer.at - older.at > COALESCE_MS) return null;
  const items: UndoEntry['items'] = { ...older.items };
  for (const list of KEYED) if (newer.items[list]) items[list] = { ...newer.items[list], ...older.items[list] };
  return {
    ...older,
    at: newer.at,
    scene: { ...newer.scene, ...older.scene },
    items,
    campaign: { ...newer.campaign, ...older.campaign },
  };
}

/** Restores the recorded parts. The caller has cloned the entry's scene (and the campaign when it has fields). */
export function applyUndo(state: PersistedRoomState, entry: UndoEntry): void {
  const scene = state.scenes[entry.sceneId] as unknown as Record<string, unknown> | undefined;
  if (!scene) return;
  restore(scene, entry.scene);
  for (const list of KEYED) {
    const changes = entry.items[list];
    if (!changes) continue;
    let items = [...((scene[list] as Array<{ id: string }> | undefined) ?? [])];
    const inserts: Array<{ value: { id: string }; index: number }> = [];
    for (const [id, change] of Object.entries(changes)) {
      const at = items.findIndex((item) => item.id === id);
      if (!('value' in change)) { if (at >= 0) items.splice(at, 1); continue; }
      const value = structuredClone(change.value) as { id: string };
      if (at >= 0) items[at] = value;
      else inserts.push({ value, index: change.index });
    }
    for (const insert of inserts.sort((a, b) => a.index - b.index)) {
      items = [...items.slice(0, Math.max(0, insert.index)), insert.value, ...items.slice(Math.max(0, insert.index))];
    }
    scene[list] = items;
  }
  restore(state.campaign as unknown as Record<string, unknown>, entry.campaign);
}

function restore(target: Record<string, unknown>, fields: Record<string, Prior>): void {
  for (const [key, field] of Object.entries(fields)) {
    if ('value' in field) target[key] = structuredClone(field.value);
    else delete target[key];
  }
}

function priorOf(source: Record<string, unknown>, key: string): Prior {
  return source[key] === undefined ? {} : { value: structuredClone(source[key]) };
}

function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
