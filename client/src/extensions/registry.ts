import type { JsonValue, MacroCommand, Op } from '../types';
import type { ComponentType } from 'react';

export type ExtensionCapability =
  | 'dice.roll'
  | 'board.read'
  | 'board.write'
  | 'documents.open'
  | 'ui.tool';

export interface ExtensionManifest {
  id: string;
  title: string;
  version: string;
  requiredCore: string;
}

export interface CommandContext {
  roomRole: string;
  sceneId: string | null;
  sendOps(operations: Op[]): void;
  roll(formula: string): { formula: string; rolls: number[]; modifier: number; total: number };
  openDocument?(uuid: string): void;
  selectTool?(tool: string): void;
  notify(message: string): void;
}

export interface ExtensionCommand {
  id: string;
  title: string;
  capability: ExtensionCapability;
  /** Validate and normalize data before execution. Never trust stored macro args. */
  parse(args: Record<string, JsonValue>): Record<string, JsonValue>;
  execute(context: CommandContext, args: Record<string, JsonValue>): void | Promise<void>;
}

export interface DocumentSubtypeRegistration {
  id: string;
  documentType: 'actor' | 'journal' | 'macro';
  label: string;
}

export interface SidebarTabRegistration {
  id: string;
  label: string;
  order: number;
}

export interface ExtensionActionRegistration {
  id: string;
  label: string;
  commandId: string;
}

export interface StandalonePageProps {
  onExit(): void;
}

/** A plugin-owned page mounted by App without depending on a room session. */
export interface StandalonePageRegistration {
  id: string;
  path: `/${string}`;
  label: string;
  description: string;
  order: number;
  component: ComponentType<StandalonePageProps>;
}

export interface ActorDirectorySectionProps {
  roomRole: string;
  busy: boolean;
  onBusy(value: boolean): void;
  onError(message: string): void;
  onImported(actorId: string): void | Promise<void>;
}

/** A plugin-owned block rendered in the Actor directory's extension slot. */
export interface ActorDirectorySectionRegistration {
  id: string;
  order: number;
  component: ComponentType<ActorDirectorySectionProps>;
}

export type CoreHook =
  | 'ready'
  | 'documentCreated'
  | 'documentUpdated'
  | 'documentDeleted'
  | 'actorClaimed'
  | 'actorReleased'
  | 'sceneActivated'
  | 'tokenCreated'
  | 'tokenMoved'
  | 'tokenDeleted'
  | 'encounterStarted'
  | 'turnChanged'
  | 'encounterEnded'
  | 'macroExecuted';

type HookListener = (payload: unknown) => void | Promise<void>;

export class ExtensionRegistry {
  private readonly extensions = new Map<string, ExtensionManifest>();
  private readonly commands = new Map<string, ExtensionCommand>();
  private readonly hooks = new Map<CoreHook, Set<HookListener>>();
  private readonly documentSubtypes = new Map<string, DocumentSubtypeRegistration>();
  private readonly sidebarTabs = new Map<string, SidebarTabRegistration>();
  private readonly documentActions = new Map<string, ExtensionActionRegistration>();
  private readonly tokenActions = new Map<string, ExtensionActionRegistration>();
  private readonly standalonePages = new Map<string, StandalonePageRegistration>();
  private readonly actorDirectorySections = new Map<string, ActorDirectorySectionRegistration>();

  registerExtension(manifest: ExtensionManifest, setup: (api: ExtensionRegistrationApi) => void): void {
    validateExtensionId(manifest.id);
    if (this.extensions.has(manifest.id)) throw new Error(`Extension already registered: ${manifest.id}`);
    this.extensions.set(manifest.id, Object.freeze({ ...manifest }));
    setup({
      command: definition => this.registerCommand(manifest.id, definition),
      hook: (name, listener) => this.on(name, listener),
      documentSubtype: definition => this.registerNamespaced(manifest.id, definition, this.documentSubtypes),
      sidebarTab: definition => this.registerNamespaced(manifest.id, definition, this.sidebarTabs),
      documentAction: definition => this.registerNamespaced(manifest.id, definition, this.documentActions),
      tokenAction: definition => this.registerNamespaced(manifest.id, definition, this.tokenActions),
      standalonePage: definition => this.registerStandalonePage(manifest.id, definition),
      actorDirectorySection: definition => this.registerNamespaced(manifest.id, definition, this.actorDirectorySections),
    });
  }

  listExtensions(): ExtensionManifest[] {
    return [...this.extensions.values()];
  }

  listCommands(): ExtensionCommand[] {
    return [...this.commands.values()];
  }

  listDocumentSubtypes(): DocumentSubtypeRegistration[] { return [...this.documentSubtypes.values()]; }
  listSidebarTabs(): SidebarTabRegistration[] { return [...this.sidebarTabs.values()].sort((a, b) => a.order - b.order); }
  listDocumentActions(): ExtensionActionRegistration[] { return [...this.documentActions.values()]; }
  listTokenActions(): ExtensionActionRegistration[] { return [...this.tokenActions.values()]; }
  listStandalonePages(): StandalonePageRegistration[] {
    return [...this.standalonePages.values()].sort((left, right) => left.order - right.order);
  }
  listActorDirectorySections(): ActorDirectorySectionRegistration[] {
    return [...this.actorDirectorySections.values()].sort((left, right) => left.order - right.order);
  }

  standalonePageForPath(pathname: string): StandalonePageRegistration | undefined {
    return this.listStandalonePages().find(page => page.path === pathname);
  }

  getCommand(id: string): ExtensionCommand | undefined {
    return this.commands.get(id);
  }

  async execute(command: MacroCommand, context: CommandContext): Promise<void> {
    const definition = this.commands.get(command.commandId);
    if (!definition) throw new Error(`未安装命令：${command.commandId}`);
    if (!hasCapability(context.roomRole, definition.capability)) throw new Error('当前身份没有执行该宏的权限');
    const args = definition.parse(command.args);
    await definition.execute(context, args);
    await this.emit('macroExecuted', { commandId: command.commandId, args, sceneId: context.sceneId });
  }

  on(name: CoreHook, listener: HookListener): () => void {
    const listeners = this.hooks.get(name) ?? new Set<HookListener>();
    listeners.add(listener);
    this.hooks.set(name, listeners);
    return () => listeners.delete(listener);
  }

  async emit(name: CoreHook, payload: unknown): Promise<void> {
    for (const listener of this.hooks.get(name) ?? []) {
      try { await listener(payload); }
      catch (error) { console.warn(`[extensions] ${name} hook failed`, error); }
    }
  }

  private registerCommand(extensionId: string, definition: ExtensionCommand): void {
    if (!definition.id.startsWith(`${extensionId}.`)) {
      throw new Error(`Command ${definition.id} must use the ${extensionId} namespace`);
    }
    if (this.commands.has(definition.id)) throw new Error(`Command already registered: ${definition.id}`);
    this.commands.set(definition.id, Object.freeze({ ...definition }));
  }


  private registerNamespaced<T extends { id: string }>(extensionId: string, definition: T, collection: Map<string, T>): void {
    if (!definition.id.startsWith(`${extensionId}.`)) throw new Error(`${definition.id} must use the ${extensionId} namespace`);
    if (collection.has(definition.id)) throw new Error(`Extension registration already exists: ${definition.id}`);
    collection.set(definition.id, Object.freeze({ ...definition }));
  }

  private registerStandalonePage(extensionId: string, definition: StandalonePageRegistration): void {
    if (!/^\/[a-z0-9][a-z0-9-]*$/u.test(definition.path) || definition.path.startsWith('/r/') || definition.path.startsWith('/api/')) {
      throw new Error(`Invalid standalone extension path: ${definition.path}`);
    }
    if ([...this.standalonePages.values()].some(page => page.path === definition.path)) {
      throw new Error(`Standalone extension path already registered: ${definition.path}`);
    }
    this.registerNamespaced(extensionId, definition, this.standalonePages);
  }
}

export interface ExtensionRegistrationApi {
  command(definition: ExtensionCommand): void;
  hook(name: CoreHook, listener: HookListener): () => void;
  documentSubtype(definition: DocumentSubtypeRegistration): void;
  sidebarTab(definition: SidebarTabRegistration): void;
  documentAction(definition: ExtensionActionRegistration): void;
  tokenAction(definition: ExtensionActionRegistration): void;
  standalonePage(definition: StandalonePageRegistration): void;
  actorDirectorySection(definition: ActorDirectorySectionRegistration): void;
}

export function hasCapability(roomRole: string, capability: ExtensionCapability): boolean {
  if (capability === 'board.read' || capability === 'documents.open' || capability === 'dice.roll') return true;
  const moderator = roomRole === 'host' || roomRole === 'dm' || roomRole === 'assistant_dm';
  if (capability === 'board.write' || capability === 'ui.tool') return moderator;
  return false;
}

function validateExtensionId(value: string): void {
  if (!/^[a-z][a-z0-9-]*$/u.test(value)) throw new Error(`Invalid extension id: ${value}`);
}

export const extensionRegistry = new ExtensionRegistry();
