import { applyOptimisticOps, type OptimisticSnapshot } from '../optimistic';
import type { Op } from '../types';
import {
  asOps,
  asViewer,
  rawRole,
  uiRole,
  type RoomSnapshot,
  type SocketMessage,
  type Viewer,
} from './protocol';

export interface PendingCommand {
  id: string;
  ops: Op[];
  acknowledgedRevision?: number;
}

interface LocalPreview {
  id: string;
  ops: Op[];
}

interface RoomStoreDependencies {
  onSnapshot: (snapshot: RoomSnapshot) => void;
  requestResync: () => void;
}

/**
 * Owns authoritative room state and optimistic overlays. It deliberately has
 * no browser or WebSocket dependency, so state reconciliation can evolve and
 * be tested independently from connection lifecycle code.
 */
export class RoomStore {
  private authoritative: RoomSnapshot | null = null;
  private pending: PendingCommand[] = [];
  private previews: LocalPreview[] = [];
  private visible: RoomSnapshot | null = null;
  private online = 0;
  private isConnected = false;

  constructor(private readonly dependencies: RoomStoreDependencies) {}

  get lastState(): RoomSnapshot | null { return this.visible; }
  get viewer(): Viewer | null { return this.visible?.viewer ?? null; }
  get lastOnline(): number { return this.online; }
  get connected(): boolean { return this.isConnected; }
  get pendingCommands(): readonly PendingCommand[] { return this.pending; }

  clear(): void {
    this.authoritative = null;
    this.pending = [];
    this.previews = [];
    this.visible = null;
    this.online = 0;
    this.isConnected = false;
  }

  markDisconnected(): void {
    this.isConnected = false;
  }

  acceptPresence(online: unknown): void {
    this.online = typeof online === 'number' ? online : 0;
    this.isConnected = true;
  }

  acceptState(message: SocketMessage): void {
    if (!message.scene) return;
    const viewer = asViewer(message.viewer);
    const effectiveRole = viewer?.roomRole ?? message.roomRole ?? message.role;
    const next: RoomSnapshot = {
      scene: message.scene,
      role: uiRole(effectiveRole),
      roomRole: rawRole(effectiveRole),
      campaign: message.campaign ?? null,
      viewer,
      revision: typeof message.revision === 'number' ? message.revision : null,
    };
    this.authoritative = next;
    this.isConnected = true;
    this.dropConfirmed(next.revision);
    this.rebuildVisible();
  }

  acceptPatch(message: SocketMessage): void {
    const revision = typeof message.revision === 'number' ? message.revision : null;
    const operations = asOps(message.ops);
    if (!this.authoritative || revision === null || operations === null || this.authoritative.revision === null
      || revision !== this.authoritative.revision + 1) {
      this.dependencies.requestResync();
      return;
    }
    const applied = applyOptimisticOps({
      scene: this.authoritative.scene,
      campaign: this.authoritative.campaign,
    }, operations);
    if (!applied) {
      this.dependencies.requestResync();
      return;
    }
    this.authoritative = { ...this.authoritative, ...applied, revision };
    this.isConnected = true;
    this.dropConfirmed(revision);
    this.rebuildVisible();
  }

  acceptAck(message: SocketMessage): void {
    if (typeof message.commandId !== 'string' || typeof message.revision !== 'number') return;
    const pending = this.pending.find((command) => command.id === message.commandId);
    if (!pending) return;
    pending.acknowledgedRevision = message.revision;
    if (this.dropConfirmed(this.authoritative?.revision ?? null)) this.rebuildVisible();
  }

  rejectCommand(message: SocketMessage): void {
    if (typeof message.commandId !== 'string') return;
    const before = this.pending.length;
    this.pending = this.pending.filter((command) => command.id !== message.commandId);
    if (this.pending.length !== before) this.rebuildVisible();
  }

  pushCommand(id: string, operations: Op[]): void {
    this.pending.push({ id, ops: operations });
    this.rebuildVisible();
  }

  pushPreview(id: string, operations: Op[]): () => void {
    const preview: LocalPreview = { id, ops: operations };
    this.previews.push(preview);
    this.rebuildVisible();
    return () => {
      const before = this.previews.length;
      this.previews = this.previews.filter((entry) => entry.id !== preview.id);
      if (this.previews.length !== before) this.rebuildVisible();
    };
  }

  private dropConfirmed(revision: number | null): boolean {
    if (revision === null) return false;
    const before = this.pending.length;
    this.pending = this.pending.filter((command) => command.acknowledgedRevision === undefined || command.acknowledgedRevision > revision);
    return this.pending.length !== before;
  }

  private rebuildVisible(): void {
    if (!this.authoritative) return;
    let projection: OptimisticSnapshot = {
      scene: this.authoritative.scene,
      campaign: this.authoritative.campaign,
    };
    for (const command of this.pending) {
      const next = applyOptimisticOps(projection, command.ops);
      if (next) projection = next;
    }
    for (const preview of this.previews) {
      const next = applyOptimisticOps(projection, preview.ops);
      if (next) projection = next;
    }
    this.visible = { ...this.authoritative, ...projection };
    this.dependencies.onSnapshot(this.visible);
  }
}
