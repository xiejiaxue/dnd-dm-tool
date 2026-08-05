export type Role = 'dm' | 'player';

export type EntryType = 'monster' | 'spell' | 'item' | 'feat' | 'condition';

export interface GridConfig {
  size: number;
  color: string;
  offset: [number, number];
  snap: boolean;
  // Whether the grid overlay is visible (DM toggles it from the toolbar).
  show: boolean;
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
  favorites: Favorite[];
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
}

export type Op =
  | { op: 'moveToken'; tokenId: string; x: number; y: number }
  | { op: 'addToken'; token: Token }
  | { op: 'removeToken'; tokenId: string }
  | { op: 'updateToken'; tokenId: string; patch: Partial<Pick<Token, 'name' | 'size' | 'avatar' | 'color' | 'hp'>> }
  | { op: 'addPlayer'; player: PlayerToken }
  | { op: 'removePlayer'; tokenId: string }
  | { op: 'updatePlayer'; tokenId: string; patch: Partial<Pick<PlayerToken, 'name' | 'color' | 'sessionId' | 'hp'>> }
  | { op: 'addWall'; wall: Wall }
  | { op: 'removeWall'; wallId: string }
  | { op: 'updateGrid'; patch: Partial<GridConfig> }
  | { op: 'updateMap'; mapImage: string | null; mapSize: [number, number]; playArea: PlayArea }
  | { op: 'updateMapScale'; mapScale: number }
  | { op: 'addEnemy'; entryId: string; nameZh: string }
  | { op: 'removeEnemy'; entryId: string }
  | { op: 'switchCampaign'; campaignId: string }
  | { op: 'submitInitiative'; name: string; value: number; tokenId: string | null; sessionId?: string | null }
  | { op: 'addToInitiative'; name: string; value: number; source: 'dm'; tokenId: string | null }
  | { op: 'removeFromInitiative'; entryId: string }
  | { op: 'advanceTurn' }
  | { op: 'reorderInitiative'; order: string[] }
  | { op: 'addFavorite'; favorite: Favorite }
  | { op: 'removeFavorite'; type: EntryType; entryId: string };

export interface IndexEntry {
  type: EntryType;
  id: string;                 // `${source}__${ENG_name}`
  nameZh: string;
  nameEn: string;
  source: string;
  bookFile: string;
  cr?: string;
  level?: number;
}
