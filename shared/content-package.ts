import { normalizeNpcMetadata } from './npc-metadata';
import type {
  NpcImportance,
  NpcRecord,
  NpcStatus,
  Token,
  TokenCondition,
  TokenConditionId,
} from './types';

/**
 * Stable, data-only contract for a campaign content package.
 *
 * Content packages are trusted as authored data, never as executable code.
 * The Worker parses this contract again before cloning it into a room, so a
 * manually uploaded or outdated R2 object cannot bypass these limits.
 */
export const CONTENT_PACKAGE_SCHEMA_VERSION = 1 as const;
export const CONTENT_PACKAGE_MAX_SCENES = 50;
export const CONTENT_PACKAGE_MAX_NPCS = 250;
export const CONTENT_PACKAGE_MAX_TOKENS_PER_SCENE = 500;

export const CONTENT_PACKAGE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
export const CONTENT_PACKAGE_ASSET_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/u;

export type ContentPackageImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif';

export interface ContentPackageSummary {
  id: string;
  name: string;
  description: string;
  version: number;
  sceneCount: number;
  npcCount: number;
}

export interface ContentPackageMap {
  /** Content-addressed object name below assets/. */
  assetId: string;
  width: number;
  height: number;
  contentType: ContentPackageImageType;
  /** Converts original image coordinates to board world coordinates. */
  mapScale: number;
}

export type ContentPackageToken = Omit<Token, 'id' | 'kind' | 'actorId' | 'hpRatio'> & {
  kind: 'monster' | 'npc';
};

export interface ContentPackageScene {
  /** Stable source identifier. Runtime room/scene IDs are generated on clone. */
  key: string;
  name: string;
  chapter: string;
  map: ContentPackageMap;
  tokens: ContentPackageToken[];
  unlocked: boolean;
}

export interface ContentPackageManifest extends ContentPackageSummary {
  schemaVersion: typeof CONTENT_PACKAGE_SCHEMA_VERSION;
  /** Optional rules-system marker reserved for compatibility checks. */
  system?: 'dnd5e';
  /** Human-readable source/license metadata; it does not grant code execution. */
  authors?: string[];
  license?: string;
  homepage?: string;
  npcs: NpcRecord[];
  scenes: ContentPackageScene[];
}

export interface ContentPackageIndex {
  schemaVersion: typeof CONTENT_PACKAGE_SCHEMA_VERSION;
  templates: ContentPackageSummary[];
}

export function isContentPackageId(value: string): boolean {
  return CONTENT_PACKAGE_ID_PATTERN.test(value);
}

export function isContentPackageAssetId(value: string): boolean {
  return CONTENT_PACKAGE_ASSET_ID_PATTERN.test(value);
}

export function parseContentPackageSummary(value: unknown): ContentPackageSummary {
  if (!isRecord(value)) throw new Error('content package summary must be an object');
  const id = boundedText(value.id, 64);
  if (!isContentPackageId(id)) throw new Error('content package id is invalid');
  return {
    id,
    name: boundedText(value.name, 120),
    description: optionalText(value.description, 500),
    version: integer(value.version, 1, 1_000_000),
    sceneCount: integer(value.sceneCount, 1, CONTENT_PACKAGE_MAX_SCENES),
    npcCount: integer(value.npcCount, 0, CONTENT_PACKAGE_MAX_NPCS),
  };
}

export function parseContentPackageManifest(value: unknown, expectedId?: string): ContentPackageManifest {
  if (!isRecord(value) || value.schemaVersion !== CONTENT_PACKAGE_SCHEMA_VERSION) {
    throw new Error('unsupported content package schema');
  }
  const summary = parseContentPackageSummary(value);
  if (expectedId !== undefined && summary.id !== expectedId) throw new Error('content package id mismatch');
  if (!Array.isArray(value.scenes) || value.scenes.length === 0 || value.scenes.length > CONTENT_PACKAGE_MAX_SCENES) {
    throw new Error('invalid content package scenes');
  }
  if (!Array.isArray(value.npcs) || value.npcs.length > CONTENT_PACKAGE_MAX_NPCS) {
    throw new Error('invalid content package npcs');
  }
  const scenes = value.scenes.map(parseContentPackageScene);
  const npcs = value.npcs.map(parseContentPackageNpc);
  if (summary.sceneCount !== scenes.length || summary.npcCount !== npcs.length) {
    throw new Error('content package counts mismatch');
  }

  const sceneKeys = new Set<string>();
  for (const scene of scenes) {
    if (sceneKeys.has(scene.key)) throw new Error(`duplicate content package scene key: ${scene.key}`);
    sceneKeys.add(scene.key);
  }
  const npcIds = new Set<string>();
  for (const npc of npcs) {
    if (npcIds.has(npc.id)) throw new Error(`duplicate content package npc id: ${npc.id}`);
    npcIds.add(npc.id);
  }
  for (const npc of npcs) {
    if (npc.statReference?.kind === 'npc' && !npcIds.has(npc.statReference.npcId)) {
      throw new Error(`unknown npc stat reference: ${npc.statReference.npcId}`);
    }
  }
  for (const scene of scenes) {
    for (const token of scene.tokens) {
      if (token.entryId?.startsWith('npc:') && !npcIds.has(token.entryId.slice(4))) {
        throw new Error(`unknown npc token reference: ${token.entryId}`);
      }
    }
  }

  return {
    schemaVersion: CONTENT_PACKAGE_SCHEMA_VERSION,
    ...summary,
    ...(value.system === undefined ? {} : { system: contentPackageSystem(value.system) }),
    ...(value.authors === undefined ? {} : { authors: contentPackageAuthors(value.authors) }),
    ...(value.license === undefined ? {} : { license: optionalText(value.license, 240) }),
    ...(value.homepage === undefined ? {} : { homepage: contentPackageHomepage(value.homepage) }),
    scenes,
    npcs,
  };
}

function parseContentPackageScene(value: unknown): ContentPackageScene {
  if (!isRecord(value) || !isRecord(value.map)) throw new Error('invalid content package scene');
  const contentType = value.map.contentType;
  if (!isContentPackageImageType(contentType)) throw new Error('invalid map content type');
  const assetId = boundedText(value.map.assetId, 120);
  if (!isContentPackageAssetId(assetId)) throw new Error('invalid content package asset id');
  const map: ContentPackageMap = {
    assetId,
    width: integer(value.map.width, 1, 20_000),
    height: integer(value.map.height, 1, 20_000),
    contentType,
    mapScale: numberIn(value.map.mapScale, 0.1, 8),
  };
  const tokenValues = value.tokens ?? [];
  if (!Array.isArray(tokenValues) || tokenValues.length > CONTENT_PACKAGE_MAX_TOKENS_PER_SCENE) {
    throw new Error('invalid content package scene tokens');
  }
  const tokens = tokenValues.map(parseContentPackageToken);
  const worldWidth = map.width * map.mapScale;
  const worldHeight = map.height * map.mapScale;
  if (tokens.some(token => token.x + token.size > worldWidth + 0.001 || token.y + token.size > worldHeight + 0.001)) {
    throw new Error('content package scene token is outside map bounds');
  }
  return {
    key: boundedText(value.key, 120),
    name: boundedText(value.name, 120),
    chapter: optionalText(value.chapter, 120),
    map,
    tokens,
    unlocked: value.unlocked === true,
  };
}

function parseContentPackageToken(value: unknown): ContentPackageToken {
  if (!isRecord(value) || (value.kind !== 'monster' && value.kind !== 'npc')) {
    throw new Error('invalid content package scene token');
  }
  const entryId = value.entryId === null || value.entryId === undefined ? null : boundedText(value.entryId, 180);
  const number = value.number === undefined ? undefined : integer(value.number, 1, 10_000);
  let hp: Token['hp'];
  if (value.hp !== undefined) {
    if (!isRecord(value.hp)) throw new Error('invalid content package token hit points');
    const maximum = integer(value.hp.max, 1, 1_000_000);
    const current = integer(value.hp.current, 0, 1_000_000);
    if (current > maximum) throw new Error('content package token current hit points exceed maximum');
    hp = { current, max: maximum };
  }
  const conditions = parseTokenConditions(value.conditions);
  const hpVisibility = value.hpVisibility === undefined ? undefined : parseHpVisibility(value.hpVisibility);
  return {
    kind: value.kind,
    name: boundedText(value.name, 120),
    entryId,
    x: numberIn(value.x, 0, 160_000),
    y: numberIn(value.y, 0, 160_000),
    size: numberIn(value.size, 12, 500),
    avatar: optionalText(value.avatar, 500),
    color: boundedText(value.color, 40),
    ...(number === undefined ? {} : { number }),
    ...(hp ? { hp } : {}),
    ...(value.hidden === undefined ? {} : { hidden: booleanValue(value.hidden) }),
    ...(value.publicName === undefined ? {} : { publicName: optionalText(value.publicName, 120) }),
    ...(hpVisibility === undefined ? {} : { hpVisibility }),
    ...(conditions.length ? { conditions } : {}),
  };
}

const CONDITION_IDS: readonly TokenConditionId[] = [
  'prone', 'grappled', 'restrained', 'stunned', 'unconscious', 'invisible', 'concentrating', 'dead',
];

function parseTokenConditions(value: unknown): TokenCondition[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > CONDITION_IDS.length) throw new Error('invalid token conditions');
  const seen = new Set<TokenConditionId>();
  return value.map(item => {
    if (!isRecord(item) || !CONDITION_IDS.includes(item.id as TokenConditionId) || seen.has(item.id as TokenConditionId)) {
      throw new Error('invalid token condition');
    }
    const id = item.id as TokenConditionId;
    seen.add(id);
    return {
      id,
      remainingRounds: item.remainingRounds === null || item.remainingRounds === undefined
        ? null
        : integer(item.remainingRounds, 1, 99),
    };
  });
}

function parseContentPackageNpc(value: unknown): NpcRecord {
  if (!isRecord(value) || !Array.isArray(value.aliases) || value.aliases.length > 12) throw new Error('invalid npc');
  const status = value.status;
  if (!isNpcStatus(status)) throw new Error('invalid npc status');
  const sourceFile = value.sourceFile === null || value.sourceFile === undefined ? null : boundedText(value.sourceFile, 180);
  const playerAccess = value.playerAccess === undefined ? undefined : parseNpcPlayerAccess(value.playerAccess);
  const npc: NpcRecord = {
    id: boundedText(value.id, 180),
    name: boundedText(value.name, 120),
    aliases: value.aliases.map(alias => boundedText(alias, 80)),
    role: optionalText(value.role, 120),
    location: optionalText(value.location, 120),
    status,
    importance: parseNpcImportance(value.importance),
    faction: optionalText(value.faction, 120),
    groupPath: parseNpcGroupPath(value.groupPath),
    statReference: parseNpcStatReference(value.statReference),
    notesMarkdown: optionalText(value.notesMarkdown, 16_000),
    ...(playerAccess === undefined ? {} : { playerAccess }),
    ...(value.publicDescription === undefined ? {} : { publicDescription: optionalText(value.publicDescription, 4_000) }),
    sourceFile,
    updatedAt: numberIn(value.updatedAt, 0, 10_000_000_000_000),
  };
  return normalizeNpcMetadata(npc);
}

function parseNpcGroupPath(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 6) throw new Error('invalid npc group path');
  return value.map(part => boundedText(part, 80));
}

function parseNpcStatReference(value: unknown): NpcRecord['statReference'] {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new Error('invalid npc stat reference');
  if (value.kind === 'custom') return { kind: 'custom' };
  if (value.kind === 'compendium') {
    return {
      kind: 'compendium',
      entryId: boundedText(value.entryId, 180),
      nameZh: boundedText(value.nameZh, 120),
      nameEn: boundedText(value.nameEn, 120),
    };
  }
  if (value.kind === 'npc') {
    return { kind: 'npc', npcId: boundedText(value.npcId, 180), name: boundedText(value.name, 120) };
  }
  throw new Error('invalid npc stat reference');
}

function isNpcStatus(value: unknown): value is NpcStatus {
  return value === 'active' || value === 'missing' || value === 'inactive' || value === 'dead';
}

function parseNpcImportance(value: unknown): NpcImportance | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'major' || value === 'supporting' || value === 'minor') return value;
  throw new Error('invalid npc importance');
}

function parseNpcPlayerAccess(value: unknown): NonNullable<NpcRecord['playerAccess']> {
  if (value === 'none' || value === 'limited' || value === 'observer') return value;
  throw new Error('invalid npc player access');
}

function parseHpVisibility(value: unknown): NonNullable<ContentPackageToken['hpVisibility']> {
  if (value === 'none' || value === 'bar' || value === 'value') return value;
  throw new Error('invalid token hp visibility');
}

function contentPackageSystem(value: unknown): 'dnd5e' {
  if (value !== 'dnd5e') throw new Error('unsupported content package system');
  return value;
}

function contentPackageAuthors(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) throw new Error('invalid content package authors');
  return value.map(author => boundedText(author, 120));
}

function contentPackageHomepage(value: unknown): string {
  const homepage = boundedText(value, 500);
  let parsed: URL;
  try {
    parsed = new URL(homepage);
  } catch {
    throw new Error('invalid content package homepage');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('invalid content package homepage');
  return parsed.toString();
}

function isContentPackageImageType(value: unknown): value is ContentPackageImageType {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp' || value === 'image/avif';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('expected boolean');
  return value;
}

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') throw new Error('expected text');
  const result = value.trim();
  if (!result || result.length > maximum) throw new Error('text length is invalid');
  return result;
}

function optionalText(value: unknown, maximum: number): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new Error('expected optional text');
  const result = value.trim();
  if (result.length > maximum) throw new Error('text length is invalid');
  return result;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error('invalid integer');
  }
  return value;
}

function numberIn(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error('invalid number');
  }
  return value;
}
