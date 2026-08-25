export type Role = 'dm' | 'player';

// Tokens share one world-space footprint by default. Keeping this in the
// shared contract prevents the board and room service from drifting apart.
export const DEFAULT_TOKEN_SIZE = 100;

// Legacy fog cell size in px. Existing rooms and imported backups may still
// carry this grid representation; new eraser actions use pixel-precise boxes.
export const FOG_CELL = 50;

// Fog is stored in the map's original coordinate space. Rendering and pointer
// lookup apply mapScale at the edge, so changing map calibration never changes
// the grid shape or reinterprets existing revealed-cell indexes.
export function fogGridSize(scene: {
  mapImage: string | null;
  mapSize: [number, number];
  mapScale?: number;
  playArea: PlayArea;
}): { cols: number; rows: number } {
  const w = scene.mapImage ? scene.mapSize[0] : scene.playArea.w;
  const h = scene.mapImage ? scene.mapSize[1] : scene.playArea.h;
  return { cols: Math.ceil(w / FOG_CELL), rows: Math.ceil(h / FOG_CELL) };
}

export type EntryType = 'monster' | 'spell' | 'item' | 'feat' | 'condition';

export interface GridConfig {
  size: number;
  color: string;
  offset: [number, number];
  snap: boolean;
}

export interface Token {
  id: string;
  kind: 'monster' | 'npc' | 'player';
  name: string;
  entryId: string | null;
  x: number;
  y: number;
  size: number;
  avatar: string;
  color: string;
  // Encounter tokens get an auto-assigned serial number per entryId (哥布林 1, 2, 3…).
  number?: number;
  // Current/max hit points filled from the monster or NPC stat block on place.
  hp?: { current: number; max: number };
}

export interface PlayerToken extends Token {
  sessionId: string | null;
}

export interface Wall {
  id: string;
  p1: [number, number];
  p2: [number, number];
}

export interface InitiativeEntry {
  id: string;
  name: string;
  value: number;
  source: 'dm' | 'player';
  sessionId: string | null;
  tokenId: string | null;
  active: boolean;
}

export interface Favorite {
  type: EntryType;
  entryId: string;
}

export interface PlayArea { x: number; y: number; w: number; h: number }

export interface FogRect { x: number; y: number; w: number; h: number }

export interface Scene {
  id: string;
  name: string;
  mapImage: string | null;
  mapSize: [number, number];
  // Scale factor applied to the map image (not to tokens/grid) so a hand-drawn
  // map can be calibrated to the grid. Defaults to 1.
  mapScale?: number;
  grid: GridConfig;
  playArea: PlayArea;
  tokens: Token[];
  players: PlayerToken[];
  walls: Wall[];
  initiative: InitiativeEntry[];
  favorites: Favorite[];
  // Fog of war: per-cell "revealed" flags, index = row*cols+col (FOG_CELL px cells).
  fog?: boolean[];
  // Version 2 stores fog in original map coordinates, independent of mapScale.
  fogVersion?: 2;
  // Pixel-precise revealed areas created by the drag-box fog eraser.
  fogReveals?: FogRect[];
  // DM unlocks a scene so players can view it in the campaign library.
  unlocked?: boolean;
}

export interface EnemyTemplate {
  entryId: string;   // 如 'MM__Goblin'
  nameZh: string;    // 如 '地精'
}

export interface SceneFolder {
  id: string;
  name: string;
}

export type NpcStatus = 'active' | 'missing' | 'inactive' | 'dead';

/** Stable campaign ordering tier. NPC explorers sort major figures first,
 * followed by supporting and minor characters inside each faction. */
export type NpcImportance = 'major' | 'supporting' | 'minor';

/** Where the combat rules shown by an NPC detail page come from. Custom
 * records parse the stat table already embedded in notes; compendium records
 * reuse one exact monster entry instead of copying a second, drifting block. */
export type NpcStatReference =
  | { kind: 'custom' }
  | { kind: 'compendium'; entryId: string; nameZh: string; nameEn: string }
  | { kind: 'npc'; npcId: string; name: string };

/** Campaign-scoped NPC notes. They intentionally live outside a Scene so the
 * DM can track a recurring character across maps and encounters. */
export interface NpcRecord {
  id: string;
  name: string;
  aliases: string[];
  role: string;
  location: string;
  status: NpcStatus;
  /** Narrative importance used for deterministic campaign-library ordering. */
  importance?: NpcImportance;
  /** Top-level allegiance used by the NPC explorer. */
  faction?: string;
  /** Canonical archive path. New data always contains exactly the faction. */
  groupPath?: string[];
  /** Every NPC resolves to either module-specific rules or a referenced stat block. */
  statReference?: NpcStatReference;
  notesMarkdown: string;
  sourceFile: string | null;
  updatedAt: number;
}

export interface Campaign {
  id: string;
  name: string;
  /** Server template provenance. Each room owns an independent cloned state. */
  templateId?: string;
  sceneIds: string[];        // 战役内的场景 id，一个场景只属于一个战役
  /** Ordered, campaign-scoped folders used to organize scene maps. */
  sceneFolders?: SceneFolder[];
  /** Scene id -> folder id. Missing entries are displayed as “未分组”. */
  sceneFolderAssignments?: Record<string, string>;
  /** Prevents a deliberately emptied template folder list being auto-created again. */
  sceneFoldersInitialized?: boolean;
  enemies: EnemyTemplate[];  // 按 entryId 去重，保持加入顺序
  // Optional for backwards compatibility with rooms created before NPC
  // tracking was introduced. New rooms always initialize an empty array.
  npcs?: NpcRecord[];
}

export type Op =
  | { op: 'moveToken'; tokenId: string; x: number; y: number }
  | { op: 'addToken'; token: Token }
  | { op: 'removeToken'; tokenId: string }
  | { op: 'updateToken'; tokenId: string; patch: Partial<Pick<Token, 'name' | 'size' | 'avatar' | 'color' | 'hp'>> }
  | { op: 'addPlayer'; player: PlayerToken }
  | { op: 'removePlayer'; tokenId: string }
  | { op: 'updatePlayer'; tokenId: string; patch: Partial<Pick<PlayerToken, 'name' | 'size' | 'color' | 'sessionId' | 'hp' | 'avatar'>> }
  | { op: 'addWall'; wall: Wall }
  | { op: 'removeWall'; wallId: string }
  | { op: 'updateGrid'; patch: Partial<GridConfig> }
  | { op: 'updateMap'; mapImage: string | null; mapSize: [number, number]; playArea: PlayArea }
  | { op: 'updateMapScale'; mapScale: number }
  | { op: 'addEnemy'; entryId: string; nameZh: string }
  | { op: 'removeEnemy'; entryId: string }
  | { op: 'upsertNpc'; npc: NpcRecord }
  | { op: 'removeNpc'; npcId: string }
  | { op: 'switchCampaign'; campaignId: string }
  | { op: 'submitInitiative'; name: string; value: number; tokenId: string | null; sessionId?: string | null }
  | { op: 'addToInitiative'; name: string; value: number; source: 'dm'; tokenId: string | null }
  | { op: 'removeFromInitiative'; entryId: string }
  | { op: 'advanceTurn' }
  | { op: 'reorderInitiative'; order: string[] }
  | { op: 'addFavorite'; favorite: Favorite }
  | { op: 'removeFavorite'; type: EntryType; entryId: string }
  | { op: 'setFog'; cells: number[]; revealed: boolean }
  | { op: 'revealFogRect'; rect: FogRect }
  | { op: 'revealAllFog' }
  | { op: 'coverAllFog' };

export interface IndexEntry {
  type: EntryType;
  id: string;                 // `${source}__${ENG_name}`
  nameZh: string;
  nameEn: string;
  source: string;
  bookFile: string;
  // True only for the read-through online fallback.  Local R2 data remains
  // the primary source so an offline/private deployment keeps working.
  online?: boolean;
  cr?: string;
  level?: number;
  // Precomputed encounter metadata. Older R2 indexes may omit these fields;
  // the Worker falls back to the complete stat block in that case.
  initiativeModifier?: number;
  hitPoints?: number;
  hasToken?: boolean;
}
