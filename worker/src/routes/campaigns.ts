import { createUserCampaign, listUserCampaigns, userModules } from "../campaigns";
import { json, readJsonObject } from "../http";
import { initializeRoom } from "../repository";
import { writeAudit } from "./audit";
import { optionalText, roomSummary } from "./fields";
import type { ApiContext, Route } from "./router";

export const campaignListRoutes: Route<ApiContext>[] = [
  {
    methods: ["GET"],
    path: "/modules",
    async handle({ env, session }) {
      return json(await userModules(env, session.userId));
    },
  },
  {
    methods: ["GET"],
    path: "/campaigns",
    async handle({ env, session, url }) {
      return json({
        campaigns: await listUserCampaigns(
          env,
          session.userId,
          url.searchParams.get("status") === "archived",
        ),
      });
    },
  },
  {
    methods: ["POST"],
    path: "/campaigns",
    async handle({ request, env, ctx, session }) {
      const body = await readJsonObject(request);
      const access = await createUserCampaign(env, session, {
        name: optionalText(body.name, "战役名称"),
        moduleId: optionalText(body.moduleId, "模组 ID"),
        copyMembersFrom: optionalText(body.copyMembersFrom, "来源战役"),
      });
      await initializeRoom(env, access);
      ctx.waitUntil(
        writeAudit(
          env,
          access,
          "campaign.create",
          "campaign",
          access.campaignId,
        ),
      );
      return json({ campaign: roomSummary(access) }, { status: 201 });
    },
  },
];
