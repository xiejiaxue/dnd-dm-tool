import { requireCampaignAccess } from "../campaigns";
import { HttpError, routeParts } from "../http";
import { accountRoutes } from "./account";
import { calendarRoutes } from "./calendar";
import { campaignManagementRoutes } from "./campaign-management";
import { campaignRoomRoutes } from "./campaign-room";
import { campaignListRoutes } from "./campaigns";
import { characterRoutes } from "./characters";
import { compendiumRoutes } from "./compendium";
import { inviteRoutes } from "./invites";
import { journalRoutes } from "./journals";
import { findRoute, type ApiContext, type CampaignRoute, type Route } from "./router";

/** Everything under /api except one campaign's own endpoints. */
export const API_ROUTES: readonly Route<ApiContext>[] = [
  ...calendarRoutes,
  ...accountRoutes,
  ...compendiumRoutes,
  ...inviteRoutes,
  ...campaignListRoutes,
];

/** Everything under /api/campaigns/:slug. */
export const CAMPAIGN_ROUTES: readonly CampaignRoute[] = [
  ...campaignManagementRoutes,
  ...campaignRoomRoutes,
  ...journalRoutes,
  ...characterRoutes,
];

export async function routeApi(context: ApiContext): Promise<Response> {
  // Drop the leading "api"; the Worker only routes paths under /api/.
  const parts = routeParts(context.url.pathname).slice(1);
  if (parts.length >= 2 && parts[0] === "campaigns")
    return routeCampaign(context, parts[1], parts.slice(2));
  const match = findRoute(API_ROUTES, context.request.method, parts);
  if (!match) throw new HttpError(404, "NOT_FOUND", "找不到接口");
  return match.route.handle(context, match.params);
}

async function routeCampaign(context: ApiContext, slug: string, rest: string[]): Promise<Response> {
  const match = findRoute(CAMPAIGN_ROUTES, context.request.method, rest);
  // Check membership before reporting a missing route, so outsiders cannot probe which campaigns exist.
  const access = await requireCampaignAccess(
    context.env,
    context.session.userId,
    slug,
    match?.route.manage ?? false,
  );
  if (!match) throw new HttpError(404, "NOT_FOUND", "找不到房间接口");
  return match.route.handle({ ...context, access }, match.params);
}
