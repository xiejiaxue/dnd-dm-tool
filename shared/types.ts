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
  /** Durable Actor document used by linked Tokens. Missing keeps legacy
   * compendium/NPC/player tokens working until their background migration. */
  actorId?: string | null;
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
  /** Hidden scene tokens remain available to moderators but are never included
   * in a normal player's room projection. Missing means visible for backwards
   * compatibility with every existing room and template. */
  hidden?: boolean;
  /** Optional player-facing alias such as “蒙面法师”. The real name remains in
   * the moderator projection and is used by encounter automation. */
  publicName?: string;
  /** Controls how much HP information a visible token exposes to players. */
  hpVisibility?: 'none' | 'bar' | 'value';
  /** Player-projection-only percentage. Persisted tokens keep authoritative HP
   * instead; the server emits this field only for bar-only visibility. */
  hpRatio?: number;
  /** Lightweight, system-neutral combat markers. A null duration persists
   * until it is cleared; finite durations tick down when a new round begins. */
  conditions?: TokenCondition[];
}

export type TokenConditionId =
  | 'prone'
  | 'grappled'
  | 'restrained'
  | 'stunned'
  | 'unconscious'
  | 'invisible'
  | 'concentrating'
  | 'dead';

export interface TokenCondition {
  id: TokenConditionId;
  remainingRounds: number | null;
}

export interface PlayerToken extends Token {
  sessionId: string | null;
}

export interface Wall {
  id: string;
  p1: [number, number];
  p2: [number, number];
}

export interface SceneInitialView {
  x: number;
  y: number;
  scale: number;
}

export interface SceneConfigurationPatch {
  name?: string;
  unlocked?: boolean;
  mapScale?: number;
  grid?: Partial<GridConfig>;
  playArea?: PlayArea;
  initialView?: SceneInitialView;
}

export interface InitiativeEntry {
  id: string;
  name: string;
  value: number;
  source: 'dm' | 'player';
  sessionId: string | null;
  tokenId: string | null;
  active: boolean;
  /** Explicit combat-tracker visibility. Missing inherits the linked Token's
   * hidden state, matching Foundry's independent combatant toggle semantics. */
  hidden?: boolean;
  /** Defeated combatants stay in the encounter history but are skipped by
   * forward/backward turn navigation. The linked Token receives `dead`. */
  defeated?: boolean;
  /** Optional encounter-only grouping such as “北门守卫”. */
  group?: string | null;
  /** Ready and delayed are tactical annotations; turn order remains explicit. */
  turnState?: 'normal' | 'ready' | 'delayed';
}

export type EncounterStatus = 'setup' | 'active' | 'ended';

/** A combat encounter is independent from the Scene document. The scene link
 * identifies where it is displayed, while round/turn and participants retain
 * their own lifecycle and can evolve without changing map persistence. */
export interface Encounter {
  id: string;
  sceneId: string;
  name: string;
  status: EncounterStatus;
  round: number;
  turn: number | null;
  combatants: InitiativeEntry[];
  createdAt: number;
  endedAt: number | null;
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
  /** Shared reset target for the canvas. Each user's temporary pan/zoom stays
   * client-local until a moderator deliberately updates this scene setting. */
  initialView?: SceneInitialView;
  tokens: Token[];
  players: PlayerToken[];
  walls: Wall[];
  /** @deprecated Persisted only for legacy room migration and projected for
   * older clients. Encounter.combatants is the authoritative combat roster. */
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

/** Player access to one campaign NPC archive. `none` omits the document,
 * `limited` exposes only its public profile, and `observer` also exposes the
 * configured public rules reference. */
export type NpcPlayerAccess = 'none' | 'limited' | 'observer';

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
  /** Defaults to none so existing private campaign notes stay private. */
  playerAccess?: NpcPlayerAccess;
  /** A separate player-safe narrative; private notesMarkdown is never reused
   * as a fallback by the server projection. */
  publicDescription?: string;
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

export type TokenUpdatePatch = Partial<Pick<Token, 'name' | 'size' | 'avatar' | 'color' | 'hidden' | 'publicName' | 'hpVisibility' | 'conditions'>> & {
  /** `null` removes HP, allowing an undo to restore an originally HP-less Token. */
  hp?: Token['hp'] | null;
};

export type PlayerUpdatePatch = Partial<Pick<PlayerToken, 'name' | 'size' | 'color' | 'sessionId' | 'avatar' | 'conditions'>> & {
  hp?: PlayerToken['hp'] | null;
};

export type Op =
  | { op: 'moveToken'; tokenId: string; x: number; y: number }
  | { op: 'addToken'; token: Token }
  | { op: 'removeToken'; tokenId: string }
  | { op: 'updateToken'; tokenId: string; patch: TokenUpdatePatch }
  | { op: 'addPlayer'; player: PlayerToken }
  | { op: 'removePlayer'; tokenId: string }
  | { op: 'updatePlayer'; tokenId: string; patch: PlayerUpdatePatch }
  | { op: 'addWall'; wall: Wall }
  | { op: 'removeWall'; wallId: string }
  | { op: 'updateWall'; wallId: string; patch: Partial<Pick<Wall, 'p1' | 'p2'>> }
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
  | { op: 'setCombatantHidden'; entryId: string; hidden: boolean }
  | { op: 'updateCombatant'; entryId: string; patch: Partial<Pick<InitiativeEntry, 'name' | 'value' | 'hidden' | 'defeated' | 'group' | 'turnState'>> }
  | { op: 'createEncounter' }
  | { op: 'duplicateEncounter' }
  | { op: 'startEncounter' }
  | { op: 'endEncounter' }
  | { op: 'previousTurn' }
  | { op: 'nextTurn' }
  | { op: 'previousRound' }
  | { op: 'nextRound' }
  | { op: 'endMyTurn' }
  /** @deprecated Retained for clients opened before the Encounter migration. */
  | { op: 'advanceTurn' }
  | { op: 'reorderInitiative'; order: string[] }
  | { op: 'addFavorite'; favorite: Favorite }
  | { op: 'removeFavorite'; type: EntryType; entryId: string }
  | { op: 'setFog'; cells: number[]; revealed: boolean }
  | { op: 'revealFogRect'; rect: FogRect }
  | { op: 'revealAllFog' }
  | { op: 'coverAllFog' }
  /** Moderator-only exact fog snapshot used by the bounded undo history. */
  | { op: 'restoreFog'; fog: boolean[] | null; fogReveals: FogRect[] };

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

export * from './documents';
export * from './tabletop-tools';
export * from './actor-system';
export * from './content-package';
export * from './plugins/dnd5e-character-sheet';
