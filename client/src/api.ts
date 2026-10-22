import type {
  ActorClaim,
  ActorDocument,
  ActorDocumentType,
  Campaign,
  DocumentOwnership,
  DocumentFolder,
  FolderDocumentType,
  EntryType,
  IndexEntry,
  JournalEntryDocument,
  JournalPage,
  JournalPageType,
  JsonValue,
  MacroCommand,
  MacroDocument,
  MacroHotbarBinding,
  MapNote,
  Scene,
  SceneConfigurationPatch,
  ActionLogEntry,
  ActionLogType,
  AssetSummary,
  EncounterPresetDocument,
  ItemDocument,
  PlaylistDocument,
  RollTableDocument,
  TabletopSettings,
  ToolDocument,
  ToolDocumentType,
} from './types';
import { publishDocumentMutation } from './extensions/mutation-events';

export interface CurrentUser {
  id: string;
  displayName?: string;
  isAnonymous?: boolean;
  platformRole?: 'owner';
  canReadAllRooms?: boolean;
}

export interface PublicSiteConfig {
  icpFiling?: string;
  publicSecurityFiling?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RoomSummary {
  id?: string;
  slug: string;
  name: string;
  role?: string;
  updatedAt?: string;
  platformReadOnly?: boolean;
}

export interface RoomMemberSummary {
  userId: string;
  displayName: string;
  role: 'host' | 'dm' | 'assistant_dm' | 'player' | 'spectator';
}

export interface RoomTemplateSummary {
  id: string;
  name: string;
  description: string;
  version: number;
  sceneCount: number;
  npcCount: number;
}

export interface SceneSummary {
  id: string;
  name: string;
  unlocked: boolean;
  mapImage: string | null;
  folderId: string | null;
}

export interface RoomBootstrap {
  room: RoomSummary;
  membership?: { role?: string; roomRole?: string; canManage?: boolean; canReadAll?: boolean };
}

export interface InviteResult {
  token?: string;
  url?: string;
  inviteUrl?: string;
  inviteCode?: string;
  expiresAt?: number | null;
  maxUses?: number | null;
  roomSlug?: string;
  room?: { slug?: string };
}

let currentRoomSlug: string | null = null;
let currentUserRequest: Promise<CurrentUser> | null = null;
let publicConfigRequest: Promise<PublicSiteConfig> | null = null;

export function setCurrentRoomSlug(slug: string | null): void {
  currentRoomSlug = slug?.trim() || null;
}

export function getCurrentRoomSlug(): string | null {
  return currentRoomSlug;
}

function roomPath(path = ''): string {
  if (!currentRoomSlug) throw new Error('请选择一个房间后再请求房间数据');
  return `/api/rooms/${encodeURIComponent(currentRoomSlug)}${path}`;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  if (!res.ok) {
    let detail = '';
    let code: string | undefined;
    try {
      const body = await res.json() as { error?: unknown; message?: unknown };
      if (typeof body.error === 'object' && body.error !== null && !Array.isArray(body.error)) {
        const structured = body.error as { code?: unknown; message?: unknown };
        code = typeof structured.code === 'string' ? structured.code : undefined;
        detail = typeof structured.message === 'string' ? structured.message : '';
      } else {
        detail = typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : '';
      }
    } catch {
      // Keep a useful HTTP error even when a proxy returns a non-JSON body.
    }
    throw new ApiError(detail || `${res.status} ${url}`, res.status, code);
  }
  const value = await res.json() as T;
  publishDocumentMutation(url, init?.method, value);
  return value;
}

function jsonRequest(method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

function pluginSubpath(path: string): string {
  if (!path || path === '/') return '';
  if (!path.startsWith('/') || path.includes('..')) throw new Error('插件接口路径无效');
  return path;
}

/**
 * A first visit has no session cookie.  De-duplicate the bootstrap request so
 * a lobby refresh and an invite redemption cannot race and create different
 * anonymous sessions before the browser stores the first Set-Cookie header.
 */
function me(): Promise<CurrentUser> {
  if (!currentUserRequest) {
    currentUserRequest = json<CurrentUser>('/api/me').catch(error => {
      currentUserRequest = null;
      throw error;
    });
  }
  return currentUserRequest;
}

function publicConfig(): Promise<PublicSiteConfig> {
  if (!publicConfigRequest) {
    publicConfigRequest = json<PublicSiteConfig>('/api/public-config').catch(error => {
      publicConfigRequest = null;
      throw error;
    });
  }
  return publicConfigRequest;
}

export const api = {
  me,
  publicConfig,
  /** Generic extension namespace; plugin-specific clients own their types. */
  plugin: <T>(pluginId: string, path: string, init?: RequestInit) =>
    json<T>(`/api/plugins/${encodeURIComponent(pluginId)}${pluginSubpath(path)}`, init),
  /** Generic room-scoped extension namespace. */
  roomPlugin: <T>(pluginId: string, path: string, init?: RequestInit) =>
    json<T>(roomPath(`/plugins/${encodeURIComponent(pluginId)}${pluginSubpath(path)}`), init),
  rooms: () => json<{ rooms: RoomSummary[] }>('/api/rooms').then(response => response.rooms),
  roomTemplates: () => json<{ templates: RoomTemplateSummary[] }>('/api/room-templates').then(response => response.templates),
  createRoom: (name: string, templateId?: string) => json<{ room: RoomSummary }>(
    '/api/rooms',
    jsonRequest('POST', { roomName: name, ...(templateId ? { templateId } : {}) }),
  ).then(response => response.room),
  deleteRoom: (slug: string) => json<{ ok: boolean }>(
    `/api/rooms/${encodeURIComponent(slug)}`,
    jsonRequest('DELETE'),
  ),
  bootstrap: () => json<RoomBootstrap>(roomPath()),
  roomMembers: () => json<RoomMemberSummary[]>(roomPath('/members')),
  createInvite: (input: { role?: 'player' | 'spectator'; maxUses?: number; expiresInHours?: number } = {}) =>
    json<InviteResult>(roomPath('/invites'), jsonRequest('POST', { role: 'player', ...input })),
  redeemInvite: (token: string) => json<InviteResult>('/api/invites/redeem', jsonRequest('POST', { token })),

  // The compendium is read-only shared data; it does not need a room identity.
  search: (q: string, type: EntryType | 'all' = 'all') =>
    json<IndexEntry[]>(`/api/search?q=${encodeURIComponent(q)}&type=${type}`),
  // Only used as a fallback when the private R2 reference library has no
  // match. The Worker pins and proxies its one reviewed upstream instead of
  // exposing a browser-side or arbitrary URL fetch.
  searchOnline: (q: string, type: EntryType | 'all' = 'all') =>
    json<IndexEntry[]>(`/api/search/online?q=${encodeURIComponent(q)}&type=${type}`),
  // Compendium records have different schemas for monster/spell/item entries.
  entry: (type: EntryType, id: string) => json<any>(`/api/entry/${type}/${encodeURIComponent(id)}`),

  scenes: () => json<SceneSummary[]>(roomPath('/scenes')),
  scene: (id: string) => json<Scene>(roomPath(`/scenes/${encodeURIComponent(id)}`)),
  createScene: (name: string) =>
    json<Scene>(roomPath('/scenes'), jsonRequest('POST', { name })),
  updateScene: (id: string, patch: SceneConfigurationPatch) =>
    json<Scene>(roomPath(`/scenes/${encodeURIComponent(id)}`), jsonRequest('PATCH', patch)),
  deleteScene: (id: string) => json<{ ok: boolean }>(roomPath(`/scenes/${encodeURIComponent(id)}`), jsonRequest('DELETE')),
  sceneNotes: (sceneId: string) => json<MapNote[]>(roomPath(`/scenes/${encodeURIComponent(sceneId)}/notes`)),
  createSceneNote: (sceneId: string, input: Omit<MapNote, 'id' | 'sceneId' | 'flags'>) => json<MapNote>(
    roomPath(`/scenes/${encodeURIComponent(sceneId)}/notes`), jsonRequest('POST', input),
  ),
  updateSceneNote: (sceneId: string, noteId: string, input: Partial<Pick<MapNote, 'x' | 'y' | 'label' | 'visibility'>>) => json<MapNote>(
    roomPath(`/scenes/${encodeURIComponent(sceneId)}/notes/${encodeURIComponent(noteId)}`), jsonRequest('PATCH', input),
  ),
  deleteSceneNote: (sceneId: string, noteId: string) => json<{ ok: boolean }>(
    roomPath(`/scenes/${encodeURIComponent(sceneId)}/notes/${encodeURIComponent(noteId)}`), jsonRequest('DELETE'),
  ),

  actors: () => json<{ actors: ActorDocument[]; claim: ActorClaim | null }>(roomPath('/actors')),
  createActor: (input: {
    name: string;
    actorType?: ActorDocumentType;
    avatar?: string;
    system?: Record<string, JsonValue>;
    prototypeToken?: ActorDocument['prototypeToken'];
    ownership?: DocumentOwnership;
  }) => json<ActorDocument>(roomPath('/actors'), jsonRequest('POST', input)),
  updateActor: (actorId: string, input: Partial<Pick<ActorDocument, 'name' | 'avatar' | 'system' | 'prototypeToken' | 'ownership' | 'folderId' | 'sort'>>) =>
    json<ActorDocument>(roomPath(`/actors/${encodeURIComponent(actorId)}`), jsonRequest('PATCH', input)),
  deleteActor: (actorId: string) => json<{ ok: boolean }>(
    roomPath(`/actors/${encodeURIComponent(actorId)}`), jsonRequest('DELETE'),
  ),
  claimActor: (actorId: string) => json<ActorClaim>(
    roomPath(`/actors/${encodeURIComponent(actorId)}/claim`), jsonRequest('POST'),
  ),
  releaseActor: (actorId: string) => json<{ ok: boolean }>(
    roomPath(`/actors/${encodeURIComponent(actorId)}/claim`), jsonRequest('DELETE'),
  ),

  toolDocuments: <T extends ToolDocument = ToolDocument>(type: ToolDocumentType) =>
    json<T[]>(roomPath(`/tools/${toolPath(type)}`)),
  createToolDocument: <T extends ToolDocument = ToolDocument>(type: ToolDocumentType, input: {
    name: string;
    folder?: string;
    data?: Record<string, JsonValue>;
    ownership?: DocumentOwnership;
  }) => json<T>(roomPath(`/tools/${toolPath(type)}`), jsonRequest('POST', input)),
  updateToolDocument: <T extends ToolDocument = ToolDocument>(type: ToolDocumentType, id: string, input: {
    name?: string;
    folder?: string;
    data?: Record<string, JsonValue>;
    ownership?: DocumentOwnership;
    locked?: boolean;
  }) => json<T>(roomPath(`/tools/${toolPath(type)}/${encodeURIComponent(id)}`), jsonRequest('PATCH', input)),
  deleteToolDocument: (type: ToolDocumentType, id: string) =>
    json<{ ok: boolean }>(roomPath(`/tools/${toolPath(type)}/${encodeURIComponent(id)}`), jsonRequest('DELETE')),
  items: () => json<ItemDocument[]>(roomPath('/tools/items')),
  rollTables: () => json<RollTableDocument[]>(roomPath('/tools/roll-tables')),
  playlists: () => json<PlaylistDocument[]>(roomPath('/tools/playlists')),
  encounterPresets: () => json<EncounterPresetDocument[]>(roomPath('/tools/encounter-presets')),

  actionLog: (limit = 100) => json<ActionLogEntry[]>(roomPath(`/action-log?limit=${Math.max(1, Math.min(500, limit))}`)),
  logAction: (input: {
    type: ActionLogType;
    label: string;
    sceneId?: string | null;
    actorId?: string | null;
    targetTokenIds?: string[];
    formula?: string | null;
    total?: number | null;
    details?: Record<string, JsonValue>;
    visibility?: 'all' | 'gm';
  }) => json<ActionLogEntry>(roomPath('/action-log'), jsonRequest('POST', input)),
  clearActionLog: () => json<{ ok: boolean }>(roomPath('/action-log'), jsonRequest('DELETE')),
  tabletopSettings: () => json<TabletopSettings>(roomPath('/settings')),
  updateTabletopSettings: (input: Partial<TabletopSettings>) =>
    json<TabletopSettings>(roomPath('/settings'), jsonRequest('PATCH', input)),
  assetLibrary: (includeArchived = false) => json<AssetSummary[]>(roomPath(`/asset-library${includeArchived ? '?archived=1' : ''}`)),
  updateAssetLibraryEntry: (id: string, input: { name?: string; archived?: boolean }) =>
    json<{ ok: boolean }>(roomPath(`/asset-library/${encodeURIComponent(id)}`), jsonRequest('PATCH', input)),

  journals: () => json<JournalEntryDocument[]>(roomPath('/journals')),
  createJournal: (name: string, ownership?: DocumentOwnership) => json<JournalEntryDocument>(
    roomPath('/journals'), jsonRequest('POST', { name, ...(ownership ? { ownership } : {}) }),
  ),
  updateJournal: (journalId: string, input: Partial<Pick<JournalEntryDocument, 'name' | 'ownership' | 'folderId' | 'sort'>>) =>
    json<JournalEntryDocument>(roomPath(`/journals/${encodeURIComponent(journalId)}`), jsonRequest('PATCH', input)),
  deleteJournal: (journalId: string) => json<{ ok: boolean }>(
    roomPath(`/journals/${encodeURIComponent(journalId)}`), jsonRequest('DELETE'),
  ),
  createJournalPage: (journalId: string, input: { name: string; type?: JournalPageType; text?: string; assetUrl?: string }) =>
    json<JournalPage>(roomPath(`/journals/${encodeURIComponent(journalId)}/pages`), jsonRequest('POST', input)),
  updateJournalPage: (journalId: string, pageId: string, input: Partial<Pick<JournalPage, 'name' | 'text' | 'assetUrl'>>) =>
    json<JournalPage>(roomPath(`/journals/${encodeURIComponent(journalId)}/pages/${encodeURIComponent(pageId)}`), jsonRequest('PATCH', input)),

  macros: () => json<MacroDocument[]>(roomPath('/macros')),
  createMacro: (input: { name: string; command: MacroCommand; icon?: string; ownership?: DocumentOwnership; folderId?: string | null; sort?: number }) =>
    json<MacroDocument>(roomPath('/macros'), jsonRequest('POST', input)),
  updateMacro: (macroId: string, input: Partial<Pick<MacroDocument, 'name' | 'command' | 'icon' | 'ownership' | 'folderId' | 'sort'>>) =>
    json<MacroDocument>(roomPath(`/macros/${encodeURIComponent(macroId)}`), jsonRequest('PATCH', input)),
  deleteMacro: (macroId: string) => json<{ ok: boolean }>(
    roomPath(`/macros/${encodeURIComponent(macroId)}`), jsonRequest('DELETE'),
  ),
  macroHotbar: () => json<MacroHotbarBinding[]>(roomPath('/macros/hotbar')),
  setMacroHotbar: (slot: number, macroId: string) => json<MacroHotbarBinding>(
    roomPath(`/macros/hotbar/${slot}`), jsonRequest('PATCH', { macroId }),
  ),
  clearMacroHotbar: (slot: number) => json<{ ok: boolean }>(
    roomPath(`/macros/hotbar/${slot}`), jsonRequest('DELETE'),
  ),

  documentFolders: (type: FolderDocumentType) => json<DocumentFolder[]>(roomPath(`/folders/${type}`)),
  createDocumentFolder: (type: FolderDocumentType, input: { name: string; parentId?: string | null; sort?: number }) =>
    json<DocumentFolder>(roomPath(`/folders/${type}`), jsonRequest('POST', input)),
  updateDocumentFolder: (type: FolderDocumentType, id: string, input: { name?: string; parentId?: string | null; sort?: number }) =>
    json<DocumentFolder>(roomPath(`/folders/${type}/${encodeURIComponent(id)}`), jsonRequest('PATCH', input)),
  deleteDocumentFolder: (type: FolderDocumentType, id: string) =>
    json<{ ok: boolean }>(roomPath(`/folders/${type}/${encodeURIComponent(id)}`), jsonRequest('DELETE')),

  campaigns: () => json<{ id: string; name: string }[]>(roomPath('/campaigns')),
  createCampaign: (name: string) =>
    json<Campaign>(roomPath('/campaigns'), jsonRequest('POST', { name })),
  deleteCampaign: (id: string) => json<{ ok: boolean }>(roomPath(`/campaigns/${encodeURIComponent(id)}`), jsonRequest('DELETE')),
  assignSceneToCampaign: (campaignId: string, sceneId: string) =>
    json<{ ok: boolean }>(roomPath(`/campaigns/${encodeURIComponent(campaignId)}/scenes`), jsonRequest('POST', { sceneId })),
  rollInitiative: (tokenIds: readonly string[]) => json<{
    rolls: { tokenId: string; name: string; value: number; modifier: number }[];
  }>(roomPath('/initiative/roll'), jsonRequest('POST', { tokenIds })),

  async uploadAsset(file: File, kind: 'map' | 'token' | 'avatar' | 'attachment'): Promise<{ id: string; url: string }> {
    const body = new FormData();
    body.append('file', file);
    // `kind` is metadata only. The Worker may safely ignore it; the route's
    // authorization and content-type checks are the security boundary.
    body.append('kind', kind);
    return json<{ id: string; url: string }>(roomPath('/assets'), { method: 'POST', body });
  },

  async uploadMap(file: File, width: number, height: number): Promise<{ url: string }> {
    const body = new FormData();
    body.append('file', file);
    body.append('width', String(width));
    body.append('height', String(height));
    // The Worker stores the image and updates the active Durable Object scene
    // in one request. This avoids losing the map mutation when a WebSocket is
    // reconnecting immediately after the file upload finishes.
    return json<{ url: string }>(roomPath('/map'), { method: 'POST', body });
  },
};

function toolPath(type: ToolDocumentType): string {
  if (type === 'item') return 'items';
  if (type === 'roll_table') return 'roll-tables';
  if (type === 'playlist') return 'playlists';
  return 'encounter-presets';
}
