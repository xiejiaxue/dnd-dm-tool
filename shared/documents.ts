/**
 * Campaign document primitives inspired by Foundry VTT's Document model.
 *
 * A document is durable campaign content. Scene-embedded objects (Tokens and
 * MapNotes) reference documents instead of duplicating their authoritative
 * data. This keeps permissions and extension metadata consistent no matter
 * where the same Actor or Journal page is used.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type WorldDocumentType = 'actor' | 'journal' | 'macro';
export type FolderDocumentType = WorldDocumentType;

/** Ordered to make permission comparisons explicit and auditable. */
export type DocumentOwnershipLevel = 'none' | 'limited' | 'observer' | 'owner';

export interface DocumentOwnership {
  /** Access for users without an explicit override. */
  default: DocumentOwnershipLevel;
  /** Stable user id -> access override. */
  users: Record<string, DocumentOwnershipLevel>;
}

/** Extension-owned data. The first key is always a registered extension id. */
export type DocumentFlags = Record<string, Record<string, JsonValue>>;

export interface WorldDocumentBase {
  id: string;
  campaignId: string;
  type: WorldDocumentType;
  name: string;
  folderId: string | null;
  sort: number;
  ownership: DocumentOwnership;
  flags: DocumentFlags;
  createdByUserId: string;
  createdAt: number;
  updatedAt: number;
}

export type ActorDocumentType = 'character' | 'npc' | 'monster';

export interface ActorPrototypeToken {
  name: string;
  avatar: string;
  color: string;
  size: number;
  hidden: boolean;
  hpVisibility: 'none' | 'bar' | 'value';
}

export interface ActorDocument extends WorldDocumentBase {
  type: 'actor';
  actorType: ActorDocumentType;
  avatar: string;
  /** System-owned sheet payload. Core code treats this as opaque JSON. */
  system: Record<string, JsonValue>;
  prototypeToken: ActorPrototypeToken;
}

export type JournalPageType = 'markdown' | 'image' | 'pdf' | 'handout';

/** Journal pages inherit their parent Journal ownership. */
export interface JournalPage {
  id: string;
  journalId: string;
  name: string;
  type: JournalPageType;
  sort: number;
  text: string;
  assetUrl: string | null;
  flags: DocumentFlags;
  createdAt: number;
  updatedAt: number;
}

export interface JournalEntryDocument extends WorldDocumentBase {
  type: 'journal';
  pages: JournalPage[];
}

/**
 * Stored macros are declarative command invocations. Arbitrary JavaScript is
 * deliberately excluded: extension code is reviewed at build time while macro
 * data only selects a registered command and supplies validated JSON args.
 */
export interface MacroCommand {
  commandId: string;
  args: Record<string, JsonValue>;
}

export interface MacroDocument extends WorldDocumentBase {
  type: 'macro';
  command: MacroCommand;
  icon: string;
}

export interface MacroHotbarBinding {
  slot: number;
  macro: MacroDocument;
}

export type WorldDocument = ActorDocument | JournalEntryDocument | MacroDocument;

export interface DocumentFolder {
  id: string;
  campaignId: string;
  documentType: FolderDocumentType;
  parentId: string | null;
  name: string;
  sort: number;
  flags: DocumentFlags;
}

/** Scene-embedded reference to a Journal or one of its pages. */
export interface MapNote {
  id: string;
  sceneId: string;
  journalId: string;
  pageId: string | null;
  x: number;
  y: number;
  label: string;
  icon: string;
  /** `inherit` uses Journal ownership; `gm` can only narrow it; `all` is an
   * explicit public signpost and still never grants edit access to the Journal. */
  visibility: 'inherit' | 'gm' | 'all';
  flags: DocumentFlags;
}

/** Claiming controls an Actor; ownership still decides sheet access. */
export interface ActorClaim {
  roomId: string;
  actorId: string;
  userId: string;
  claimedAt: number;
}

export interface DocumentViewer {
  userId: string;
  roomRole: 'host' | 'dm' | 'assistant_dm' | 'player' | 'spectator';
  platformReadOnly?: boolean;
}

const OWNERSHIP_ORDER: Record<DocumentOwnershipLevel, number> = {
  none: 0,
  limited: 1,
  observer: 2,
  owner: 3,
};

export const DEFAULT_PRIVATE_OWNERSHIP: DocumentOwnership = Object.freeze({
  default: 'none',
  users: Object.freeze({}),
});

export function documentOwnershipLevel(
  ownership: DocumentOwnership,
  viewer: DocumentViewer,
): DocumentOwnershipLevel {
  if (viewer.roomRole === 'host' || viewer.roomRole === 'dm' || viewer.roomRole === 'assistant_dm') return 'owner';
  // A platform owner may audit content but never edit another table.
  if (viewer.platformReadOnly) return 'observer';
  return ownership.users[viewer.userId] ?? ownership.default;
}

export function hasDocumentPermission(
  ownership: DocumentOwnership,
  viewer: DocumentViewer,
  required: DocumentOwnershipLevel,
): boolean {
  return OWNERSHIP_ORDER[documentOwnershipLevel(ownership, viewer)] >= OWNERSHIP_ORDER[required];
}

export function canSeeDocument(ownership: DocumentOwnership, viewer: DocumentViewer): boolean {
  return hasDocumentPermission(ownership, viewer, 'limited');
}

export function canReadDocument(ownership: DocumentOwnership, viewer: DocumentViewer): boolean {
  return hasDocumentPermission(ownership, viewer, 'observer');
}

export function canUpdateDocument(ownership: DocumentOwnership, viewer: DocumentViewer): boolean {
  return hasDocumentPermission(ownership, viewer, 'owner');
}

export function normalizeDocumentOwnership(value: unknown): DocumentOwnership {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { default: 'none', users: {} };
  const input = value as Record<string, unknown>;
  const fallback = isOwnershipLevel(input.default) ? input.default : 'none';
  const users: Record<string, DocumentOwnershipLevel> = {};
  if (input.users && typeof input.users === 'object' && !Array.isArray(input.users)) {
    for (const [userId, level] of Object.entries(input.users as Record<string, unknown>)) {
      if (userId.length <= 180 && isOwnershipLevel(level)) users[userId] = level;
    }
  }
  return { default: fallback, users };
}

export function isOwnershipLevel(value: unknown): value is DocumentOwnershipLevel {
  return value === 'none' || value === 'limited' || value === 'observer' || value === 'owner';
}

/** Stable cross-document link syntax used by journals, notes and extensions. */
export function documentUuid(type: WorldDocumentType, id: string, embeddedId?: string | null): string {
  const root = `${type[0].toUpperCase()}${type.slice(1)}.${id}`;
  return embeddedId ? `${root}.Page.${embeddedId}` : root;
}
