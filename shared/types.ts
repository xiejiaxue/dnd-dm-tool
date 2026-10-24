import type { QuestStatus } from './faction-quests';
import type { FogRectangle } from './fog';
export type Role = 'dm' | 'player';

export { FOG_CELL, fogGridSize, fogGeometry, resolveFogBasisScale } from './fog';

export type EntryType =
  | 'monster' | 'spell' | 'item' | 'feat' | 'condition'
  | 'race' | 'subrace' | 'background' | 'class' | 'subclass'
  | 'classFeature' | 'subclassFeature' | 'optionalFeature'
  | 'language' | 'vehicle' | 'action' | 'reward';

export interface GridConfig {
  size: number;
  color: string;
  offset: [number, number];
  snap: boolean;
}

export interface Token {
  id: string;
  kind: 'monster' | 'player';
  name: string;
  entryId: string | null;
  x: number;
  y: number;
  size: number;
  avatar: string;
  color: string;
  // Monster tokens get an auto-assigned serial number per entryId (哥布林 1, 2, 3…).
  number?: number;
  // Current/max hit points (monsters only; filled from the stat block on place).
  hp?: { current: number; max: number };
  initiativeBonus?: number;
  /** Hidden encounter tokens are only sent to the DM. Legacy tokens stay visible. */
  hidden?: boolean;
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
  // Combat round, starting at 1 on the first advance; absent outside combat.
  round?: number;
  favorites: Favorite[];
  // Revealed flags in the frozen image-space raster: row * fogGridSize(scene).cols + col.
  fog?: boolean[];
  // Frozen fog raster density in original-image coordinates; independent of mapScale.
  fogBasisScale?: number;
  fogReveals?: FogRectangle[];
  // DM unlocks a scene so players can view it in the campaign library.
  unlocked?: boolean;
}

export interface EnemyTemplate {
  entryId: string;   // 如 'MM__Goblin'
  nameZh: string;    // 如 '地精'
}

export interface Campaign {
  id: string;
  name: string;
  sceneIds: string[];        // 战役内的场景 id，一个场景只属于一个战役
  enemies: EnemyTemplate[];  // 按 entryId 去重，保持加入顺序
  // DM-only faction quest tracking (Dragon Heist); stripped from player projections.
  questProgress?: Record<string, QuestStatus>;  // questId → status; 'open' is stored as absent
  factionNotes?: Record<string, string>;        // factionId → DM note
}

export interface ChatMessage {
  id: string;
  campaignId: string;
  userId: string;
  author: string;
  kind: 'chat' | 'roll';
  text: string;
  formula?: string;
  rolls?: number[];
  // Indices into rolls discarded by keep-highest/lowest (e.g. 2d20kh1).
  dropped?: number[];
  total?: number;
  visibility: 'public' | 'gm' | 'self';
  createdAt: number;
}

export type Op =
  | { op: 'moveToken'; tokenId: string; x: number; y: number }
  | { op: 'addToken'; token: Token }
  | { op: 'removeToken'; tokenId: string }
  | { op: 'updateToken'; tokenId: string; patch: Partial<Pick<Token, 'name' | 'size' | 'avatar' | 'color' | 'hp' | 'initiativeBonus' | 'hidden'>> }
  | { op: 'addPlayer'; player: PlayerToken }
  | { op: 'removePlayer'; tokenId: string }
  | { op: 'updatePlayer'; tokenId: string; patch: Partial<Pick<PlayerToken, 'name' | 'color' | 'sessionId' | 'hp' | 'avatar' | 'initiativeBonus'>> }
  | { op: 'addWall'; wall: Wall }
  | { op: 'removeWall'; wallId: string }
  | { op: 'updateGrid'; patch: Partial<GridConfig> }
  | { op: 'updateMap'; mapImage: string | null; mapSize: [number, number]; playArea: PlayArea; fogBasisScale?: number }
  | { op: 'updateMapScale'; mapScale: number; fogBasisScale?: number }
  | { op: 'addEnemy'; entryId: string; nameZh: string }
  | { op: 'removeEnemy'; entryId: string }
  | { op: 'switchCampaign'; campaignId: string }
  | { op: 'submitInitiative'; name: string; value: number; tokenId: string | null; sessionId?: string | null }
  | { op: 'addToInitiative'; name: string; value: number; source: 'dm'; tokenId: string | null }
  | { op: 'removeFromInitiative'; entryId: string }
  | { op: 'advanceTurn' }
  | { op: 'previousTurn' }
  | { op: 'setQuestStatus'; questId: string; status: QuestStatus }
  | { op: 'setFactionNote'; factionId: string; note: string }
  | { op: 'reorderInitiative'; order: string[] }
  | { op: 'addFavorite'; favorite: Favorite }
  | { op: 'removeFavorite'; type: EntryType; entryId: string }
  | { op: 'setFog'; cells: number[]; revealed: boolean; basisScale?: number }
  | { op: 'revealFogRect'; rect: FogRectangle }
  | { op: 'revealAllFog' }
  | { op: 'coverAllFog' };

export interface IndexEntry {
  type: EntryType;
  id: string;                 // `${source}__${ENG_name}`
  nameZh: string;
  nameEn: string;
  source: string;
  bookFile: string;
  lookupKey?: string;
  // True only for the read-through online fallback.  Local R2 data remains
  // the primary source so an offline/private deployment keeps working.
  online?: boolean;
  cr?: string;
  level?: number;
}
