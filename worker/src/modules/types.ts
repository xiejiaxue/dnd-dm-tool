import type { PresetScene } from '../../../shared/encounter-presets';
import type { IndexEntry, Scene } from '../../../shared/types';
import type { PersistedRoomState, RoomActor } from '../domain';

/** One map entry from a module's `room-templates/<id>/manifest.json` in REFERENCE_DATA. */
export interface ModuleMap { assetId: string; width: number; height: number; mapScale?: number }

/** Data a module adds to the rulebook search, monster cards and token images. */
export interface ModuleCompendium {
  search(query: string, type: string): IndexEntry[];
  monsterCard(id: string): unknown;
  /** SVG markup, or undefined when the id is not one of this module's creatures. */
  token(id: string): string | undefined;
}

export interface ModuleRouteContext {
  method: 'GET' | 'POST';
  /** The decoded path segment after the route name, present only when the route declares `param`. */
  param?: string;
  actor: RoomActor;
  state(): PersistedRoomState;
  body(): Promise<Record<string, unknown>>;
  /** Applies `update` as one idempotent command, persists it and broadcasts the new state. */
  mutate<T>(commandId: unknown, action: string, update: (next: PersistedRoomState) => T, sceneIds: string[]): T;
}
export interface ModuleRouteResult { status?: number; body: unknown }

/**
 * A module-specific endpoint, served at `/api/campaigns/:slug/<path>[/<param>]`. The Worker forwards
 * it to the campaign's Durable Object, which runs `handle` there so it can read and change live state.
 */
export interface ModuleRoute {
  path: string;
  param: boolean;
  methods: readonly ('GET' | 'POST')[];
  moderatorOnly: boolean;
  handle(context: ModuleRouteContext): ModuleRouteResult | Promise<ModuleRouteResult>;
}

export interface AdventureModule {
  /** The `templateId` stored in campaign_modules.template_json; never change it for a published module. */
  id: string;
  /** Shown in every user's library. Changing either string adds a second library entry for existing users. */
  library: { name: string; description: string };
  scenes: {
    /** The manifest must list exactly this many maps. */
    count: number;
    /**
     * Checks one manifest map before import and may return a step that fills its new scene, such as
     * placing preset tokens. Throws an HttpError when the map does not belong to this module version.
     */
    prepare?(map: ModuleMap): ((scene: Scene) => void) | undefined;
  };
  compendium?: ModuleCompendium;
  /** Keyed map presets whose overviews and area notes the DM can search from a campaign of this module. */
  presets?: readonly PresetScene[];
  routes?: readonly ModuleRoute[];
}
