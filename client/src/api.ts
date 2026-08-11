import type { Campaign, EntryType, IndexEntry, Scene } from './types';

export interface CurrentUser {
  id: string;
  displayName?: string;
  isAnonymous?: boolean;
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
}

export interface RoomBootstrap {
  room: RoomSummary;
  membership?: { role?: string; roomRole?: string; canManage?: boolean };
  modules: CampaignModuleSummary[];
  campaigns: CampaignSaveSummary[];
  activeCampaign: { id: string; name: string } | null;
  selectedCharacter: CampaignCharacterSummary | null;
}

export interface CampaignModuleSummary { id: string; name: string; description: string }
export interface CampaignSaveSummary {
  id: string;
  name: string;
  moduleId: string | null;
  moduleName: string;
  updatedAt: number;
  lastPlayedAt: number | null;
  active: boolean;
}
export interface CampaignCharacterSummary {
  id: string;
  campaignId: string;
  name: string;
  color: string;
  avatarUrl: string;
  maxHp: number;
  updatedAt?: number;
}
export interface CharacterCompendiumEntry { id: string; type: EntryType; entryId: string; name: string; source: string; quantity: number; prepared: boolean }
export interface CharacterSheet { character: CampaignCharacterSummary; entries: CharacterCompendiumEntry[] }
export interface CampaignJournal { id: string; title: string; content: string; visibility: 'dm' | 'players'; updatedAt: number }

export interface InviteResult {
  token?: string;
  url?: string;
  inviteUrl?: string;
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
  return res.json() as Promise<T>;
}

function jsonRequest(method: 'POST' | 'DELETE', body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
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
  rooms: () => json<{ rooms: RoomSummary[] }>('/api/rooms').then(response => response.rooms),
  createRoom: (name: string) => json<{ room: RoomSummary }>('/api/rooms', jsonRequest('POST', { roomName: name })).then(response => response.room),
  bootstrap: () => json<RoomBootstrap>(roomPath()),

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

  scenes: () => json<{ id: string; name: string; unlocked: boolean }[]>(roomPath('/scenes')),
  scene: (id: string) => json<Scene>(roomPath(`/scenes/${encodeURIComponent(id)}`)),
  createScene: (name: string) =>
    json<Scene>(roomPath('/scenes'), jsonRequest('POST', { name })),
  deleteScene: (id: string) => json<{ ok: boolean }>(roomPath(`/scenes/${encodeURIComponent(id)}`), jsonRequest('DELETE')),

  modules: () => json<CampaignModuleSummary[]>(roomPath('/modules')),
  campaigns: () => json<CampaignSaveSummary[]>(roomPath('/campaigns')),
  createCampaign: (name: string, moduleId: string) =>
    json<CampaignSaveSummary>(roomPath('/campaigns'), jsonRequest('POST', { name, moduleId })),
  selectCampaign: (id: string) =>
    json<CampaignSaveSummary>(roomPath(`/campaigns/${encodeURIComponent(id)}/select`), jsonRequest('POST')),
  deleteCampaign: (id: string) => json<{ ok: boolean }>(roomPath(`/campaigns/${encodeURIComponent(id)}`), jsonRequest('DELETE')),
  assignSceneToCampaign: (campaignId: string, sceneId: string) =>
    json<{ ok: boolean }>(roomPath(`/campaigns/${encodeURIComponent(campaignId)}/scenes`), jsonRequest('POST', { sceneId })),

  characters: (campaignId: string) =>
    json<CampaignCharacterSummary[]>(roomPath(`/characters?campaignId=${encodeURIComponent(campaignId)}`)),
  createCharacter: (input: { campaignId: string; name: string; color: string; maxHp: number }) =>
    json<CampaignCharacterSummary>(roomPath('/characters'), jsonRequest('POST', input)),
  selectCharacter: (campaignId: string, characterId: string) =>
    json<CampaignCharacterSummary>(roomPath(`/characters/${encodeURIComponent(characterId)}/select`), jsonRequest('POST', { campaignId })),

  characterSheet: () => json<CharacterSheet>(roomPath('/character-sheet')),
  addCharacterEntry: (entry: { type: EntryType; entryId: string; name: string; source: string }) =>
    json<CharacterCompendiumEntry>(roomPath('/character-sheet/entries'), jsonRequest('POST', entry)),
  removeCharacterEntry: (id: string) =>
    json<{ ok: boolean }>(roomPath(`/character-sheet/entries/${encodeURIComponent(id)}`), jsonRequest('DELETE')),

  journals: () => json<CampaignJournal[]>(roomPath('/journals')),
  createJournal: (input: { title: string; content: string; visibility: 'dm' | 'players' }) =>
    json<CampaignJournal>(roomPath('/journals'), jsonRequest('POST', input)),
  updateJournal: (id: string, input: { title: string; content: string; visibility: 'dm' | 'players' }) =>
    json<CampaignJournal>(roomPath(`/journals/${encodeURIComponent(id)}`), jsonRequest('POST', input)),

  async uploadAsset(file: File, kind: 'map' | 'token'): Promise<{ url: string }> {
    const body = new FormData();
    body.append('file', file);
    // `kind` is metadata only. The Worker may safely ignore it; the route's
    // authorization and content-type checks are the security boundary.
    body.append('kind', kind);
    return json<{ url: string }>(roomPath('/assets'), { method: 'POST', body });
  },
};
