import type { DocumentOwnership, JsonValue } from './documents';

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type ItemDocumentType = 'weapon' | 'armor' | 'consumable' | 'spell' | 'feat' | 'equipment' | 'loot';
export type ActorActionKind = 'check' | 'save' | 'attack' | 'damage' | 'healing' | 'utility';
export type EffectChangeMode = 'add' | 'multiply' | 'override' | 'upgrade' | 'downgrade';

export interface ActorAction {
  id: string;
  name: string;
  kind: ActorActionKind;
  formula: string;
  damageFormula?: string;
  description?: string;
}

export interface ActiveEffectChange {
  path: string;
  mode: EffectChangeMode;
  value: number;
}

export interface ActiveEffect {
  id: string;
  name: string;
  enabled: boolean;
  source?: string;
  remainingRounds: number | null;
  changes: ActiveEffectChange[];
}

export interface OwnedItem {
  id: string;
  sourceItemId: string | null;
  name: string;
  itemType: ItemDocumentType;
  image: string;
  quantity: number;
  equipped: boolean;
  description: string;
  system: Record<string, JsonValue>;
  actions: ActorAction[];
  effects: ActiveEffect[];
}

export interface Dnd5eActorSystem {
  level: number;
  proficiency: number;
  armorClass: number;
  speed: number;
  hitPoints: { current: number; max: number; temporary: number };
  abilities: Record<AbilityKey, number>;
  skills: Record<string, number>;
  resources: Array<{ id: string; name: string; current: number; max: number }>;
  biography: string;
  notes: string;
  actions: ActorAction[];
  items: OwnedItem[];
  effects: ActiveEffect[];
}

export type ToolDocumentType = 'item' | 'roll_table' | 'playlist' | 'encounter_preset';

export interface ToolDocumentBase {
  id: string;
  campaignId: string;
  documentType: ToolDocumentType;
  name: string;
  folder: string;
  sort: number;
  ownership: DocumentOwnership;
  locked: boolean;
  createdByUserId: string;
  createdAt: number;
  updatedAt: number;
}

export interface ItemDocument extends ToolDocumentBase {
  documentType: 'item';
  itemType: ItemDocumentType;
  image: string;
  description: string;
  system: Record<string, JsonValue>;
  actions: ActorAction[];
  effects: ActiveEffect[];
}

export interface RollTableResult {
  id: string;
  text: string;
  weight: number;
  drawn: boolean;
  documentUuid?: string;
}

export interface RollTableDocument extends ToolDocumentBase {
  documentType: 'roll_table';
  replacement: boolean;
  results: RollTableResult[];
}

export interface PlaylistTrack {
  id: string;
  name: string;
  assetUrl: string;
  volume: number;
  loop: boolean;
}

export interface PlaylistDocument extends ToolDocumentBase {
  documentType: 'playlist';
  tracks: PlaylistTrack[];
}

export interface EncounterPresetCombatant {
  id: string;
  name: string;
  sourceType: 'actor' | 'compendium' | 'manual';
  sourceId: string | null;
  count: number;
  initiativeModifier: number;
  hidden: boolean;
}

export interface EncounterPresetDocument extends ToolDocumentBase {
  documentType: 'encounter_preset';
  combatants: EncounterPresetCombatant[];
  notes: string;
}

export type ToolDocument = ItemDocument | RollTableDocument | PlaylistDocument | EncounterPresetDocument;

export type ActionLogType = 'roll' | 'damage' | 'healing' | 'effect' | 'encounter' | 'handout' | 'system';

export interface ActionLogEntry {
  id: string;
  roomId: string;
  campaignId: string;
  sceneId: string | null;
  actorId: string | null;
  targetTokenIds: string[];
  type: ActionLogType;
  label: string;
  formula: string | null;
  total: number | null;
  details: Record<string, JsonValue>;
  visibility: 'all' | 'gm';
  createdByUserId: string;
  createdByName: string;
  createdAt: number;
}

export interface AssetSummary {
  id: string;
  name: string;
  kind: 'map' | 'token' | 'avatar' | 'attachment' | 'other';
  url: string;
  contentType: string;
  byteSize: number;
  createdAt: number;
  archived: boolean;
}

export interface TabletopSettings {
  compactMode: boolean;
  reduceMotion: boolean;
  fontScale: number;
  confirmDestructiveActions: boolean;
  defaultRollMode: 'all' | 'gm';
  showFloatingText: boolean;
  keybindings: Record<string, string>;
}

export const DEFAULT_TABLETOP_SETTINGS: TabletopSettings = {
  compactMode: false,
  reduceMotion: false,
  fontScale: 1,
  confirmDestructiveActions: true,
  defaultRollMode: 'all',
  showFloatingText: true,
  keybindings: {
    'ui.command-palette': 'Mod+K',
    'ui.toggle-dice': 'D',
    'ui.toggle-library': 'L',
    'ui.toggle-encounter': 'E',
    'history.undo': 'Mod+Z',
    'history.redo': 'Mod+Shift+Z',
    'encounter.next-turn': 'N',
  },
};
