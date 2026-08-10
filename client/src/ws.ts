import { useEffect, useState } from 'react';
import { applyOptimisticOps, type OptimisticSnapshot } from './optimistic';
import type { Campaign, Op, Role, Scene } from './types';

/** Identity comes from the same-origin HttpOnly session used for WebSocket auth. */
export interface Viewer {
  userId: string;
  roomMemberId?: string;
  roomRole?: string;
  displayName?: string;
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
}

type RoomSnapshot = {
  scene: Scene;
  role: RoomViewRole;
  roomRole: string;
  campaign: Campaign | null;
  viewer: Viewer | null;
  revision: number | null;
};

type SocketMessage = {
  type: string;
  scene?: Scene;
  role?: unknown;
  roomRole?: unknown;
  campaign?: Campaign | null;
  viewer?: unknown;
  revision?: unknown;
  online?: unknown;
  message?: unknown;
  commandId?: unknown;
  ops?: unknown;
};

type Listener = (msg: SocketMessage) => void;

interface PendingCommand {
  id: string;
  ops: Op[];
  acknowledgedRevision?: number;
}

interface LocalPreview {
  id: string;
  ops: Op[];
}

function asViewer(value: unknown): Viewer | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (typeof source.userId !== 'string') return null;
  return {
    userId: source.userId,
    ...(typeof source.roomMemberId === 'string' ? { roomMemberId: source.roomMemberId } : {}),
    ...(typeof source.roomRole === 'string' ? { roomRole: source.roomRole } : {}),
    ...(typeof source.displayName === 'string' ? { displayName: source.displayName } : {}),
  };
}

function uiRole(value: unknown): RoomViewRole {
  if (value === 'dm' || value === 'owner' || value === 'co_dm' || value === 'host' || value === 'assistant_dm') return 'dm';
  return value === 'spectator' ? 'spectator' : 'player';
}

function rawRole(value: unknown): string {
  return typeof value === 'string' ? value : 'player';
}

function asOps(value: unknown): Op[] | null {
  return Array.isArray(value) && value.every((item) => item && typeof item === 'object' && typeof (item as { op?: unknown }).op === 'string')
    ? value as Op[]
    : null;
}

function commandId(): string {
  return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `command-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Returns the server-owned identity key used by existing token components. */
export function getMySessionId(): string {
  return connection.viewer?.userId ?? '';
}

/**
 * One connection singleton owns WebSocket reconnects and optimistic display
 * state. React components only subscribe, so StrictMode remounts cannot issue
 * duplicate room commands or lose a pending visual update.
 */
class Connection {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private activeRoomSlug: string | null = null;
  private authoritative: RoomSnapshot | null = null;
  private pending: PendingCommand[] = [];
  private previews: LocalPreview[] = [];

  // The rendered value, formed by replaying pending commands and local upload
  // previews over the last server projection. It remains public for the small
  // existing `useScene` hook surface.
  lastState: RoomSnapshot | null = null;
  lastOnline = 0;
  connected = false;
  viewer: Viewer | null = null;

  get roomSlug(): string | null {
    return this.activeRoomSlug;
  }

  connect(roomSlug: string): void {
    const normalised = roomSlug.trim();
    if (!normalised) throw new Error('room slug is required');
    if (normalised === this.activeRoomSlug) {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
      const generation = ++this.generation;
      this.open(normalised, generation);
      return;
    }
    this.stopSocket();
    this.activeRoomSlug = normalised;
    this.clearSnapshot();
    const generation = ++this.generation;
    this.open(normalised, generation);
  }

  disconnect(): void {
    ++this.generation;
    this.activeRoomSlug = null;
    this.stopSocket();
    this.clearSnapshot();
  }

  private stopSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const old = this.ws;
    this.ws = null;
    if (old && (old.readyState === WebSocket.OPEN || old.readyState === WebSocket.CONNECTING)) old.close();
  }

  private clearSnapshot(): void {
    this.authoritative = null;
    this.lastState = null;
    this.pending = [];
    this.previews = [];
    this.lastOnline = 0;
    this.connected = false;
    this.viewer = null;
    this.emit({ type: 'reset' });
  }

  private open(roomSlug: string, generation: number): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${encodeURIComponent(roomSlug)}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      if (generation !== this.generation || this.ws !== ws) return;
      this.retry = 0;
      // A legacy server ignores this harmlessly; the current room actor uses
      // it only after sending the initial full state.
      this.sendRaw({ type: 'capabilities', patches: 1 });
      for (const pending of this.pending) {
        if (pending.acknowledgedRevision === undefined) this.sendRaw({ type: 'op', id: pending.id, ops: pending.ops });
      }
    };
    ws.onmessage = (event) => {
      if (generation !== this.generation || this.ws !== ws) return;
      const msg = this.parse(event.data);
      if (!msg) return;
      if (msg.type === 'state' && msg.scene) {
        this.acceptState(msg);
        return;
      }
      if (msg.type === 'patch') {
        this.acceptPatch(msg);
        return;
      }
      if (msg.type === 'ack') {
        this.acceptAck(msg);
        return;
      }
      if (msg.type === 'meta') {
        this.lastOnline = typeof msg.online === 'number' ? msg.online : 0;
        this.connected = true;
      } else if (msg.type === 'error') {
        this.rejectCommand(msg);
      }
      this.emit(msg);
    };
    ws.onclose = () => {
      if (generation !== this.generation || this.ws !== ws) return;
      this.ws = null;
      this.connected = false;
      this.emit({ type: 'disconnected' });
      if (this.activeRoomSlug !== roomSlug) return;
      const delay = Math.min(1000 * 2 ** this.retry, 10_000);
      this.retry += 1;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (generation === this.generation && this.activeRoomSlug === roomSlug) this.open(roomSlug, generation);
      }, delay);
    };
  }

  private acceptState(msg: SocketMessage): void {
    const viewer = asViewer(msg.viewer);
    const effectiveRole = viewer?.roomRole ?? msg.roomRole ?? msg.role;
    const next: RoomSnapshot = {
      scene: msg.scene!,
      role: uiRole(effectiveRole),
      roomRole: rawRole(effectiveRole),
      campaign: msg.campaign ?? null,
      viewer,
      revision: typeof msg.revision === 'number' ? msg.revision : null,
    };
    this.authoritative = next;
    this.connected = true;
    this.dropConfirmed(next.revision);
    this.rebuildVisible();
  }

  private acceptPatch(msg: SocketMessage): void {
    const revision = typeof msg.revision === 'number' ? msg.revision : null;
    const operations = asOps(msg.ops);
    if (!this.authoritative || revision === null || operations === null || this.authoritative.revision === null
      || revision !== this.authoritative.revision + 1) {
      this.requestResync();
      return;
    }
    const applied = applyOptimisticOps({ scene: this.authoritative.scene, campaign: this.authoritative.campaign }, operations);
    if (!applied) {
      this.requestResync();
      return;
    }
    this.authoritative = { ...this.authoritative, ...applied, revision };
    this.connected = true;
    this.dropConfirmed(revision);
    this.rebuildVisible();
  }

  private acceptAck(msg: SocketMessage): void {
    if (typeof msg.commandId !== 'string' || typeof msg.revision !== 'number') return;
    const pending = this.pending.find((command) => command.id === msg.commandId);
    if (!pending) return;
    pending.acknowledgedRevision = msg.revision;
    if (this.dropConfirmed(this.authoritative?.revision ?? null)) this.rebuildVisible();
  }

  private rejectCommand(msg: SocketMessage): void {
    if (typeof msg.commandId !== 'string') return;
    const before = this.pending.length;
    this.pending = this.pending.filter((command) => command.id !== msg.commandId);
    if (this.pending.length !== before) this.rebuildVisible();
  }

  private dropConfirmed(revision: number | null): boolean {
    if (revision === null) return false;
    const before = this.pending.length;
    this.pending = this.pending.filter((command) => command.acknowledgedRevision === undefined || command.acknowledgedRevision > revision);
    return this.pending.length !== before;
  }

  private rebuildVisible(): void {
    if (!this.authoritative) return;
    let projection: OptimisticSnapshot = { scene: this.authoritative.scene, campaign: this.authoritative.campaign };
    for (const command of this.pending) {
      const next = applyOptimisticOps(projection, command.ops);
      if (next) projection = next;
    }
    for (const preview of this.previews) {
      const next = applyOptimisticOps(projection, preview.ops);
      if (next) projection = next;
    }
    this.lastState = { ...this.authoritative, ...projection };
    this.viewer = this.lastState.viewer;
    this.emit({
      type: 'state',
      scene: this.lastState.scene,
      role: this.lastState.role,
      roomRole: this.lastState.roomRole,
      campaign: this.lastState.campaign,
      viewer: this.lastState.viewer,
      revision: this.lastState.revision,
    });
  }

  private requestResync(): void {
    this.sendRaw({ type: 'resync' });
  }

  private parse(data: unknown): SocketMessage | null {
    if (typeof data !== 'string') return null;
    try {
      const parsed = JSON.parse(data) as unknown;
      if (!parsed || typeof parsed !== 'object' || typeof (parsed as { type?: unknown }).type !== 'string') return null;
      return parsed as SocketMessage;
    } catch {
      return null;
    }
  }

  /** Send and immediately predict a durable, server-authorized board command. */
  sendOps(ops: Op[]): void {
    if (!ops.length) return;
    const pending: PendingCommand = { id: commandId(), ops };
    this.pending.push(pending);
    this.rebuildVisible();
    this.sendRaw({ type: 'op', id: pending.id, ops: pending.ops });
  }

  /**
   * Overlay a local object URL while a map/avatar file uploads. It never leaves
   * this browser and is explicitly removed by the caller before the durable
   * R2 URL is sent to the room.
   */
  previewOps(ops: Op[]): () => void {
    const preview: LocalPreview = { id: commandId(), ops };
    this.previews.push(preview);
    this.rebuildVisible();
    return () => {
      const before = this.previews.length;
      this.previews = this.previews.filter((entry) => entry.id !== preview.id);
      if (this.previews.length !== before) this.rebuildVisible();
    };
  }

  /** Raw room controls (scene switching, legacy commands) remain authoritative. */
  sendControl(msg: unknown): void {
    this.sendRaw(msg);
  }

  private sendRaw(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  onMessage(cb: Listener): () => void {
    this.listeners.add(cb);
    if (this.lastState) {
      cb({
        type: 'state',
        scene: this.lastState.scene,
        role: this.lastState.role,
        roomRole: this.lastState.roomRole,
        campaign: this.lastState.campaign,
        viewer: this.lastState.viewer,
        revision: this.lastState.revision,
      });
    }
    if (this.connected) cb({ type: 'meta', online: this.lastOnline });
    return () => this.listeners.delete(cb);
  }

  private emit(msg: SocketMessage): void {
    for (const listener of this.listeners) listener(msg);
  }
}

const connection = new Connection();

export function useScene(): SceneState {
  const [state, setState] = useState<SceneState>(() => ({
    scene: connection.lastState?.scene ?? null,
    role: connection.lastState?.role ?? 'player',
    roomRole: connection.lastState?.roomRole ?? 'player',
    viewer: connection.lastState?.viewer ?? null,
    revision: connection.lastState?.revision ?? null,
    online: connection.lastOnline,
    connected: connection.connected,
    campaign: connection.lastState?.campaign ?? null,
  }));
  useEffect(() => connection.onMessage((msg) => {
    if (msg.type === 'state' && msg.scene) {
      const viewer = asViewer(msg.viewer);
      const effectiveRole = viewer?.roomRole ?? msg.roomRole ?? msg.role;
      setState(current => ({
        ...current,
        scene: msg.scene,
        role: uiRole(effectiveRole),
        roomRole: rawRole(effectiveRole),
        viewer,
        revision: typeof msg.revision === 'number' ? msg.revision : null,
        campaign: msg.campaign ?? null,
        connected: true,
      }));
    } else if (msg.type === 'meta') {
      setState(current => ({ ...current, online: typeof msg.online === 'number' ? msg.online : 0, connected: true }));
    } else if (msg.type === 'reset' || msg.type === 'disconnected') {
      setState({
        scene: null,
        role: 'player',
        roomRole: 'player',
        viewer: null,
        revision: null,
        online: 0,
        connected: false,
        campaign: null,
      });
    } else if (msg.type === 'error') {
      console.warn('[ws]', typeof msg.message === 'string' ? msg.message : 'Room WebSocket error');
    }
  }), []);

  return state;
}

export { connection };
