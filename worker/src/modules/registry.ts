import type { IndexEntry } from '../../../shared/types';
import { curseOfStrahd } from './curse-of-strahd';
import { hoardOfTheDragonQueen } from './hoard-of-the-dragon-queen';
import { lostMineOfPhandelver } from './lost-mine-of-phandelver';
import type { AdventureModule, ModuleRoute } from './types';
import { waterdeepDragonHeist } from './waterdeep-dragon-heist';

/**
 * Every built-in adventure module. To add one, create a directory beside these exporting an
 * AdventureModule and list it here; nothing else in the Worker names a specific module.
 * Order matters: search results and token or card lookups try modules in this order.
 */
export const MODULES: readonly AdventureModule[] = [waterdeepDragonHeist, curseOfStrahd, lostMineOfPhandelver, hoardOfTheDragonQueen];

/** Campaigns created before templateId was stored were Dragon Heist; their shared maps still resolve under it. */
export const LEGACY_TEMPLATE_ID = waterdeepDragonHeist.id;

export function findModule(id: string | undefined): AdventureModule | undefined {
  return MODULES.find(module => module.id === id);
}

/** Route names the core campaign API and the Durable Object already use; module routes must avoid them. */
export const RESERVED_ROUTE_PATHS = [
  'archive', 'assets', 'character-sheet', 'characters', 'invites', 'journals', 'members', 'scenes', 'ws',
  'bootstrap', 'connect', 'initialize', 'refresh-access',
] as const;

export function findModuleRoute(path: string, hasParam: boolean, method: string): ModuleRoute | undefined {
  for (const module of MODULES)
    for (const route of module.routes ?? [])
      if (route.path === path && route.param === hasParam && (route.methods as readonly string[]).includes(method)) return route;
  return undefined;
}

export function searchModules(query: string, type: string): IndexEntry[] {
  return MODULES.flatMap(module => module.compendium?.search(query, type) ?? []);
}
export function moduleMonsterCard(id: string): unknown {
  for (const module of MODULES) {
    const card = module.compendium?.monsterCard(id);
    if (card) return card;
  }
  return undefined;
}
export function moduleToken(id: string): string | undefined {
  for (const module of MODULES) {
    const svg = module.compendium?.token(id);
    if (svg) return svg;
  }
  return undefined;
}
