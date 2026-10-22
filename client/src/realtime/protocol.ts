import type { Campaign, Encounter, Op, Role, Scene } from '../types';

/** Identity comes from the same-origin HttpOnly session used for WebSocket auth. */
export interface Viewer {
  userId: string;
  roomMemberId?: string;
  roomRole?: string;
  displayName?: string;
  canManage?: boolean;
  canReadAll?: boolean;
}

export type RoomViewRole = Role | 'spectator';

export interface SceneState {
  scene: Scene | null;
  role: RoomViewRole;
  roomRole: string;
  viewer: Viewer | null;
  revision: number | null;
  online: number;
  connected: boolean;
  campaign: Campaign | null;
  encounter: Encounter | null;
  activeSceneId: string | null;
  viewingInactive: boolean;
}

export interface RoomSnapshot {
  scene: Scene;
  role: RoomViewRole;
  roomRole: string;
  campaign: Campaign | null;
  encounter: Encounter | null;
  viewer: Viewer | null;
  revision: number | null;
  activeSceneId: string;
  viewingInactive: boolean;
}

export interface SocketMessage {
  type: string;
  scene?: Scene;
  role?: unknown;
  roomRole?: unknown;
  campaign?: Campaign | null;
  encounter?: Encounter | null;
  viewer?: unknown;
  revision?: unknown;
  online?: unknown;
  message?: unknown;
  commandId?: unknown;
  ops?: unknown;
  activeSceneId?: unknown;
  viewingInactive?: unknown;
  journalId?: unknown;
  pageId?: unknown;
}

export type RoomMessageListener = (message: SocketMessage) => void;

export function asViewer(value: unknown): Viewer | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (typeof source.userId !== 'string') return null;
  return {
    userId: source.userId,
    ...(typeof source.roomMemberId === 'string' ? { roomMemberId: source.roomMemberId } : {}),
    ...(typeof source.roomRole === 'string' ? { roomRole: source.roomRole } : {}),
    ...(typeof source.displayName === 'string' ? { displayName: source.displayName } : {}),
    ...(typeof source.canManage === 'boolean' ? { canManage: source.canManage } : {}),
    ...(typeof source.canReadAll === 'boolean' ? { canReadAll: source.canReadAll } : {}),
  };
}

export function uiRole(value: unknown): RoomViewRole {
  if (value === 'dm' || value === 'owner' || value === 'co_dm' || value === 'host' || value === 'assistant_dm') return 'dm';
  return value === 'spectator' ? 'spectator' : 'player';
}

export function rawRole(value: unknown): string {
  return typeof value === 'string' ? value : 'player';
}

export function asOps(value: unknown): Op[] | null {
  return Array.isArray(value) && value.every((item) => item && typeof item === 'object' && typeof (item as { op?: unknown }).op === 'string')
    ? value as Op[]
    : null;
}

export function parseSocketMessage(data: unknown): SocketMessage | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { type?: unknown }).type !== 'string') return null;
    return parsed as SocketMessage;
  } catch {
    return null;
  }
}

export function newCommandId(): string {
  return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `command-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
