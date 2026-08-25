import { FOG_CELL, fogGridSize, type Campaign, type Scene, type SceneFolder, type Wall } from '../../../shared/types';
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
