import type { Op } from '../types';
import type { Scene } from '../types';
import { newCommandId, type RoomMessageListener, type SocketMessage, type Viewer } from './protocol';
import { RoomStore } from './RoomStore';
import { SocketTransport, type TransportStatus } from './SocketTransport';

/**
 * Coordinates transport and state without exposing either implementation to
 * React. The existing singleton facade in ws.ts remains the UI-facing API.
 */
export class RoomConnection {
  private readonly transport = new SocketTransport();
  private readonly store: RoomStore;
  private readonly listeners = new Set<RoomMessageListener>();
  private activeRoomSlug: string | null = null;

  constructor() {
    this.store = new RoomStore({
      onSnapshot: (snapshot) => this.emit({ type: 'state', ...snapshot }),
      requestResync: () => this.transport.send({ type: 'resync' }),
    });
    this.transport.onMessage = (message) => this.handleMessage(message);
    this.transport.onStatus = (status) => this.handleStatus(status);
  }

  get roomSlug(): string | null { return this.activeRoomSlug; }
  get lastState() { return this.store.lastState; }
  get lastOnline(): number { return this.store.lastOnline; }
  get connected(): boolean { return this.store.connected; }
  get viewer(): Viewer | null { return this.store.viewer; }

  connect(roomSlug: string): void {
    const normalized = roomSlug.trim();
    if (!normalized) throw new Error('room slug is required');
    if (normalized === this.activeRoomSlug && this.transport.isActive) return;
    if (normalized !== this.activeRoomSlug) {
      this.transport.disconnect();
      this.store.clear();
      this.emit({ type: 'reset' });
    }
    this.activeRoomSlug = normalized;
    this.transport.connect(normalized);
  }

  disconnect(): void {
    this.activeRoomSlug = null;
    this.transport.disconnect();
    this.store.clear();
    this.emit({ type: 'reset' });
  }

  sendOps(operations: Op[]): void {
    if (!operations.length) return;
    const id = newCommandId();
    this.store.pushCommand(id, operations);
    this.transport.send({ type: 'op', id, ops: operations });
  }

  previewOps(operations: Op[]): () => void {
    return this.store.pushPreview(newCommandId(), operations);
  }

  viewScene(scene: Scene | null): void {
    this.store.setViewedScene(scene);
  }

  activateScene(sceneId: string): void {
    this.store.setViewedScene(null);
    this.transport.send({ type: 'switchScene', sceneId });
  }

  sendControl(message: unknown): void {
    this.transport.send(message);
  }

  onMessage(listener: RoomMessageListener): () => void {
    this.listeners.add(listener);
    const state = this.store.lastState;
    if (state) listener({ type: 'state', ...state });
    if (this.store.connected) listener({ type: 'meta', online: this.store.lastOnline });
    return () => this.listeners.delete(listener);
  }

  private handleStatus(status: TransportStatus): void {
    if (status === 'connected') {
      // Preserve the wire order used by the former monolith: capability first,
      // followed by any unacknowledged commands that survived a reconnect.
      this.transport.send({ type: 'capabilities', patches: 1 });
      for (const pending of this.store.pendingCommands) {
        if (pending.acknowledgedRevision === undefined) {
          this.transport.send({ type: 'op', id: pending.id, ops: pending.ops });
        }
      }
      return;
    }
    this.store.markDisconnected();
    this.emit({ type: 'disconnected' });
  }

  private handleMessage(message: SocketMessage): void {
    if (message.type === 'state' && message.scene) {
      this.store.acceptState(message);
      return;
    }
    if (message.type === 'patch') {
      const previousRevision = this.store.lastState?.revision ?? null;
      this.store.acceptPatch(message);
      const committedRevision = typeof message.revision === 'number' ? message.revision : null;
      if (committedRevision !== null && committedRevision !== previousRevision && this.store.lastState?.revision === committedRevision) {
        this.emit({ ...message, type: 'committedOps' });
      }
      return;
    }
    if (message.type === 'ack') {
      this.store.acceptAck(message);
      return;
    }
    if (message.type === 'meta') {
      this.store.acceptPresence(message.online);
    } else if (message.type === 'error') {
      this.store.rejectCommand(message);
    }
    this.emit(message);
  }

  private emit(message: SocketMessage): void {
    for (const listener of this.listeners) listener(message);
  }
}
