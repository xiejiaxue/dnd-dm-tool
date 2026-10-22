import { DND5E_CHARACTER_SHEET_PLUGIN_ID } from '../../../shared/plugins/dnd5e-character-sheet';
import type { Session } from '../auth';
import { HttpError } from '../http';
import type { RoomAccess } from '../repository';
import { routeCharacterSheetPlugin, routeRoomCharacterSheetPlugin } from './dnd5e-character-sheet';

interface WorkerPlugin {
  id: string;
  route(request: Request, env: Env, session: Session, rest: string[]): Promise<Response>;
  routeRoom?(request: Request, env: Env, access: RoomAccess, rest: string[]): Promise<Response>;
}

const installedPlugins = new Map<string, WorkerPlugin>([
  [DND5E_CHARACTER_SHEET_PLUGIN_ID, {
    id: DND5E_CHARACTER_SHEET_PLUGIN_ID,
    route: routeCharacterSheetPlugin,
    routeRoom: routeRoomCharacterSheetPlugin,
  }],
]);

/** Core delegates a namespace; only this compile-time installation list knows implementations. */
export function routeInstalledPlugin(
  request: Request,
  env: Env,
  session: Session,
  pluginId: string,
  rest: string[],
): Promise<Response> {
  const plugin = installedPlugins.get(pluginId);
  if (!plugin) throw new HttpError(404, 'PLUGIN_NOT_FOUND', '未安装该插件');
  return plugin.route(request, env, session, rest);
}

export function routeInstalledRoomPlugin(
  request: Request,
  env: Env,
  access: RoomAccess,
  pluginId: string,
  rest: string[],
): Promise<Response> {
  const plugin = installedPlugins.get(pluginId);
  if (!plugin?.routeRoom) throw new HttpError(404, 'PLUGIN_NOT_FOUND', '该插件没有房间接口');
  return plugin.routeRoom(request, env, access, rest);
}
