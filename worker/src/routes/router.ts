import type { Session } from "../auth";
import type { RoomAccess } from "../repository";

export interface ApiContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  session: Session;
  url: URL;
}
export interface CampaignContext extends ApiContext {
  access: RoomAccess;
}

export type Params = Record<string, string>;

/**
 * One endpoint. `path` is relative to its table's mount point: `/api` for API routes and
 * `/api/campaigns/:slug` for campaign routes. `:name` segments capture one decoded path part.
 */
export interface Route<C> {
  methods: readonly string[] | "*";
  path: string;
  handle(context: C, params: Params): Promise<Response>;
}

/** Campaign routes that change a campaign's status need owner-level access before anything else runs. */
export interface CampaignRoute extends Route<CampaignContext> {
  manage?: boolean;
}

/** Returns the first route whose method and path match; tables list routes in priority order. */
export function findRoute<R extends Route<never>>(
  routes: readonly R[],
  method: string,
  parts: readonly string[],
): { route: R; params: Params } | undefined {
  for (const route of routes) {
    if (route.methods !== "*" && !route.methods.includes(method)) continue;
    const pattern = route.path.split("/").filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params: Params = {};
    const matches = pattern.every((segment, index) => {
      if (!segment.startsWith(":")) return segment === parts[index];
      params[segment.slice(1)] = parts[index];
      return true;
    });
    if (matches) return { route, params };
  }
  return undefined;
}
