import { FOG_CELL, fogGridSize, type Campaign, type Encounter, type Scene, type SceneFolder, type TokenCondition, type TokenConditionId, type Wall } from '../../../shared/types';
import { consolidateNpcRecords } from '../../../shared/npc-metadata';
import type { PersistedRoomState } from '../domain';

type RetiredAutoWall = Wall & { source?: unknown };
type SceneWithRetiredAutoRooms = Scene & { roomRegions?: unknown };

/** Remove persisted output from the retired automatic room detector while
 * retaining every wall created with the manual wall tool. */
export function removeRetiredAutoRoomData(state: PersistedRoomState): boolean {
  let changed = false;
  for (const scene of Object.values(state.scenes)) {
    const manualWalls = scene.walls.filter((wall) => (wall as RetiredAutoWall).source !== 'auto');
    if (manualWalls.length !== scene.walls.length) {
      scene.walls = manualWalls;
      changed = true;
    }

    const legacyScene = scene as SceneWithRetiredAutoRooms;
    if (Object.prototype.hasOwnProperty.call(legacyScene, 'roomRegions')) {
      delete legacyScene.roomRegions;
      changed = true;
    }
  }
  return changed;
}

/** Convert the pre-v2 fog grid, whose shape depended on mapScale, into stable
 * original-map coordinates. Nearest-neighbor sampling preserves the revealed
 * area at the same relative place on the image. */
export function normalizeLegacyMapFog(scene: Scene): boolean {
  if (scene.fogVersion === 2) return false;
  if (scene.mapImage && scene.fog) {
    const { cols, rows } = fogGridSize(scene);
    const mapScale = scene.mapScale ?? 1;
    const legacyCols = Math.ceil(scene.mapSize[0] * mapScale / FOG_CELL);
    const legacyRows = Math.ceil(scene.mapSize[1] * mapScale / FOG_CELL);
    if (scene.fog.length === legacyCols * legacyRows && mapScale !== 1) {
      const legacyFog = scene.fog;
      const normalizedFog = new Array<boolean>(cols * rows).fill(false);
      for (let row = 0; row < rows; row += 1) {
        const legacyRow = Math.min(legacyRows - 1, Math.floor((row + 0.5) * mapScale));
        for (let column = 0; column < cols; column += 1) {
          const legacyColumn = Math.min(legacyCols - 1, Math.floor((column + 0.5) * mapScale));
          normalizedFog[row * cols + column] = Boolean(legacyFog[legacyRow * legacyCols + legacyColumn]);
        }
      }
      scene.fog = normalizedFog;
    } else if (scene.fog.length !== cols * rows) {
      scene.fog = new Array<boolean>(cols * rows).fill(false);
    }
  }
  scene.fogVersion = 2;
  return true;
}

export function normalizePersistedRoomState(state: PersistedRoomState): boolean {
  let changed = removeRetiredAutoRoomData(state);
  if (normalizeEncounters(state)) changed = true;
  if (normalizeVisibilityState(state)) changed = true;
  for (const campaign of Object.values(state.campaigns)) {
    if (!Array.isArray(campaign.npcs)) {
      campaign.npcs = [];
      changed = true;
    } else if (normalizeCampaignNpcs(campaign, campaign.sceneIds.map(sceneId => state.scenes[sceneId]).filter(Boolean))) {
      changed = true;
    }
    if (normalizeSceneFolders(state, campaign)) changed = true;
  }
  for (const scene of Object.values(state.scenes)) {
    if (normalizeLegacyMapFog(scene)) changed = true;
  }
  return changed;
}

/** Reject malformed legacy visibility metadata at the persistence boundary.
 * Missing values intentionally remain absent because their secure defaults are
 * part of the projection policy: old Tokens are visible, old NPC documents are
 * private, and old HP values are shown normally. */
export function normalizeVisibilityState(state: PersistedRoomState): boolean {
  let changed = false;
  for (const scene of Object.values(state.scenes)) {
    for (const token of [...scene.tokens, ...scene.players]) {
      const raw = token as unknown as Record<string, unknown>;
      if (raw.hidden !== undefined && typeof raw.hidden !== 'boolean') {
        delete raw.hidden;
        changed = true;
      }
      if (raw.publicName !== undefined && typeof raw.publicName !== 'string') {
        delete raw.publicName;
        changed = true;
      } else if (typeof raw.publicName === 'string') {
        const normalized = raw.publicName.trim().slice(0, 120);
        if (normalized !== raw.publicName) {
          raw.publicName = normalized;
          changed = true;
        }
      }
      if (raw.hpVisibility !== undefined && raw.hpVisibility !== 'none' && raw.hpVisibility !== 'bar' && raw.hpVisibility !== 'value') {
        delete raw.hpVisibility;
        changed = true;
      }
      if (raw.hpRatio !== undefined) {
        delete raw.hpRatio;
        changed = true;
      }
      const normalizedConditions = normalizeTokenConditions(raw.conditions);
      if (JSON.stringify(normalizedConditions) !== JSON.stringify(raw.conditions ?? [])) changed = true;
      if (normalizedConditions.length) raw.conditions = normalizedConditions;
      else if (raw.conditions !== undefined) delete raw.conditions;
    }
  }
  for (const campaign of Object.values(state.campaigns)) {
    for (const npc of campaign.npcs ?? []) {
      const raw = npc as unknown as Record<string, unknown>;
      if (raw.playerAccess !== undefined && raw.playerAccess !== 'none' && raw.playerAccess !== 'limited' && raw.playerAccess !== 'observer') {
        delete raw.playerAccess;
        changed = true;
      }
      if (raw.publicDescription !== undefined && typeof raw.publicDescription !== 'string') {
        delete raw.publicDescription;
        changed = true;
      } else if (typeof raw.publicDescription === 'string' && raw.publicDescription.length > 4_000) {
        raw.publicDescription = raw.publicDescription.slice(0, 4_000);
        changed = true;
      }
    }
  }
  for (const encounter of Object.values(state.encounters)) {
    for (const entry of encounter.combatants) {
      const raw = entry as unknown as Record<string, unknown>;
      if (raw.hidden !== undefined && typeof raw.hidden !== 'boolean') {
        delete raw.hidden;
        changed = true;
      }
      if (raw.defeated !== undefined && typeof raw.defeated !== 'boolean') {
        delete raw.defeated;
        changed = true;
      }
      if (raw.group !== undefined && raw.group !== null && typeof raw.group !== 'string') {
        delete raw.group;
        changed = true;
      }
      if (raw.turnState !== undefined && raw.turnState !== 'normal' && raw.turnState !== 'ready' && raw.turnState !== 'delayed') {
        delete raw.turnState;
        changed = true;
      }
    }
  }
  return changed;
}

const CONDITION_IDS: readonly TokenConditionId[] = [
  'prone', 'grappled', 'restrained', 'stunned', 'unconscious', 'invisible', 'concentrating', 'dead',
];

function normalizeTokenConditions(value: unknown): TokenCondition[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<TokenConditionId>();
  const result: TokenCondition[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const source = item as { id?: unknown; remainingRounds?: unknown };
    if (!CONDITION_IDS.includes(source.id as TokenConditionId) || seen.has(source.id as TokenConditionId)) continue;
    const id = source.id as TokenConditionId;
    const remainingRounds = source.remainingRounds === null || source.remainingRounds === undefined
      ? null
      : typeof source.remainingRounds === 'number' && Number.isInteger(source.remainingRounds)
        ? Math.max(1, Math.min(99, source.remainingRounds))
        : null;
    seen.add(id);
    result.push({ id, remainingRounds });
  }
  return result;
}

/** Move the former Scene.initiative array into a room-level Encounter exactly
 * once. The legacy field is then kept empty in persistence and materialized
 * only in role-aware projections for tabs running an older client bundle. */
export function normalizeEncounters(state: PersistedRoomState): boolean {
  const legacy = state as PersistedRoomState & {
    encounters?: Record<string, Encounter>;
    currentEncounterId?: string | null;
  };
  let changed = false;
  if (!legacy.encounters || typeof legacy.encounters !== 'object' || Array.isArray(legacy.encounters)) {
    legacy.encounters = {};
    changed = true;
  }
  const encounters = legacy.encounters;
  for (const scene of Object.values(state.scenes)) {
    const entries = Array.isArray(scene.initiative) ? scene.initiative : [];
    const existing = Object.values(encounters).find((encounter) => encounter.sceneId === scene.id);
    if (!existing && entries.length > 0) {
      const activeIndex = entries.findIndex((entry) => entry.active);
      const encounter: Encounter = {
        id: `encounter-migrated-${scene.id}`,
        sceneId: scene.id,
        name: `${scene.name} 遭遇`,
        status: activeIndex >= 0 ? 'active' : 'setup',
        round: activeIndex >= 0 ? 1 : 0,
        turn: activeIndex >= 0 ? activeIndex : null,
        combatants: structuredClone(entries),
        createdAt: 0,
        endedAt: null,
      };
      encounter.combatants.forEach((entry, index) => { entry.active = encounter.status === 'active' && encounter.turn === index; });
      encounters[encounter.id] = encounter;
      changed = true;
    }
    if (entries.length > 0) {
      scene.initiative = [];
      changed = true;
    }
  }
  if (legacy.currentEncounterId === undefined || (legacy.currentEncounterId && !encounters[legacy.currentEncounterId])) {
    const current = Object.values(encounters).filter((encounter) => encounter.sceneId === state.currentSceneId).at(-1);
    legacy.currentEncounterId = current?.id ?? null;
    changed = true;
  }
  state.encounters = encounters;
  state.currentEncounterId = legacy.currentEncounterId ?? null;
  return changed;
}

/** Collapse every legacy archive into faction -> character, merge accidentally
 * split Markdown sections, and keep already-placed NPC tokens linked to the
 * surviving single-file record. */
export function normalizeCampaignNpcs(campaign: Campaign, scenes: readonly Scene[] = []): boolean {
  const current = campaign.npcs ?? [];
  const { records: normalized, idRemap } = consolidateNpcRecords(current);
  let changed = JSON.stringify(normalized) !== JSON.stringify(current);
  campaign.npcs = normalized;
  const byId = new Map(normalized.map(npc => [npc.id, npc]));
  for (const scene of scenes) {
    for (const token of scene.tokens) {
      if (token.kind !== 'npc' || !token.entryId?.startsWith('npc:')) continue;
      const previousId = token.entryId.slice(4);
      const nextId = idRemap.get(previousId);
      if (!nextId || nextId === previousId) continue;
      token.entryId = `npc:${nextId}`;
      const npc = byId.get(nextId);
      if (npc) token.name = npc.name;
      changed = true;
    }
  }
  return changed;
}

/**
 * Adds folder metadata to older room snapshots. Existing Dragon Heist rooms
 * derive chapters once from their generated scene-name prefix; after that all
 * user edits, including deleting every folder, are preserved verbatim.
 */
export function normalizeSceneFolders(state: PersistedRoomState, campaign: Campaign): boolean {
  let changed = false;
  const wasInitialized = campaign.sceneFoldersInitialized === true;
  const folderSource: unknown = campaign.sceneFolders;
  const folders: SceneFolder[] = [];
  const folderIds = new Set<string>();
  if (Array.isArray(folderSource)) {
    for (const value of folderSource) {
      if (!value || typeof value !== 'object') { changed = true; continue; }
      const source = value as { id?: unknown; name?: unknown };
      const id = typeof source.id === 'string' ? source.id.trim() : '';
      const name = typeof source.name === 'string' ? source.name.trim().slice(0, 80) : '';
      if (!id || !name || folderIds.has(id)) { changed = true; continue; }
      folderIds.add(id);
      folders.push({ id, name });
    }
  } else {
    changed = true;
  }

  const assignments: Record<string, string> = {};
  const assignmentSource: unknown = campaign.sceneFolderAssignments;
  if (assignmentSource && typeof assignmentSource === 'object' && !Array.isArray(assignmentSource)) {
    for (const [sceneId, folderId] of Object.entries(assignmentSource)) {
      if (campaign.sceneIds.includes(sceneId) && typeof folderId === 'string' && folderIds.has(folderId)) {
        assignments[sceneId] = folderId;
      } else {
        changed = true;
      }
    }
  } else if (assignmentSource !== undefined) {
    changed = true;
  }

  if (!wasInitialized && campaign.templateId === 'waterdeep-dragon-heist' && folders.length === 0) {
    const chapterFolders = new Map<string, string>();
    for (const sceneId of campaign.sceneIds) {
      const chapter = chapterFromSceneName(state.scenes[sceneId]?.name ?? '');
      if (!chapter) continue;
      let folderId = chapterFolders.get(chapter);
      if (!folderId) {
        folderId = `folder-${crypto.randomUUID()}`;
        chapterFolders.set(chapter, folderId);
        folders.push({ id: folderId, name: chapter });
        folderIds.add(folderId);
      }
      assignments[sceneId] = folderId;
    }
    if (chapterFolders.size > 0) changed = true;
  }

  if (campaign.sceneFolders !== folders) campaign.sceneFolders = folders;
  campaign.sceneFolderAssignments = assignments;
  if (!wasInitialized) {
    campaign.sceneFoldersInitialized = true;
    changed = true;
  }
  return changed;
}

function chapterFromSceneName(name: string): string | null {
  const separator = name.indexOf(' · ');
  const prefix = (separator >= 0 ? name.slice(0, separator) : name).trim();
  return /^第[0-9一二三四五六七八九十百]+章(?:\s|$)/u.test(prefix) ? prefix.slice(0, 80) : null;
}
