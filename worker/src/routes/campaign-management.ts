import { campaignMembers, removeCampaignMember, setCampaignStatus } from "../campaigns";
import { HttpError, json } from "../http";
import { callRoom, deleteCampaign, initializeRoom, type RoomAccess } from "../repository";
import type { CampaignContext, CampaignRoute } from "./router";

async function changeStatus({ request, env, access }: CampaignContext, status: "archived" | "active") {
  if (request.method !== "POST")
    throw new HttpError(405, "METHOD_NOT_ALLOWED", "请求方式无效");
  // Initialize before changing status so no half-created runtime can block a restore.
  await initializeRoom(env, access);
  await setCampaignStatus(env, access, status);
  await syncAccess(env, access);
  return json({ ok: true, status });
}

async function syncAccess(env: Env, access: RoomAccess): Promise<void> {
  const synced = await callRoom(env, access, "POST", "/refresh-access");
  if (!synced.ok)
    throw new HttpError(
      503,
      "ACCESS_SYNC_PENDING",
      "权限更新待同步，请重试",
    );
}

export const campaignManagementRoutes: CampaignRoute[] = [
  {
    manage: true,
    methods: ["DELETE"],
    path: "/",
    async handle({ env, access }) {
      await deleteCampaign(env, access);
      return json({ ok: true });
    },
  },
  // Any method reaches these two so a wrong one, DELETE included, answers 405 only after the owner check.
  { manage: true, methods: "*", path: "/archive", handle: (context) => changeStatus(context, "archived") },
  { manage: true, methods: "*", path: "/restore", handle: (context) => changeStatus(context, "active") },
  {
    methods: ["GET"],
    path: "/members",
    async handle({ env, access }) {
      return json({ members: await campaignMembers(env, access) });
    },
  },
  {
    methods: ["DELETE"],
    path: "/members/:memberId",
    async handle({ env, access }, { memberId }) {
      await initializeRoom(env, access);
      await removeCampaignMember(env, access, memberId);
      await syncAccess(env, access);
      return json({ ok: true });
    },
  },
];
