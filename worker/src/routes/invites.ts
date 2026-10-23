import { HttpError, json, nonEmptyText, readJsonObject } from "../http";
import { redeemRoomInvite } from "../repository";
import { writeInviteAudit } from "./audit";
import type { ApiContext, Route } from "./router";

export const inviteRoutes: Route<ApiContext>[] = [
  {
    // This is intentionally not a valid route; keep invite redemption below
    // explicit so a malformed path cannot accidentally consume a credential.
    methods: ["POST"],
    path: "/invites",
    async handle() {
      throw new HttpError(404, "NOT_FOUND", "找不到邀请操作");
    },
  },
  {
    methods: ["POST"],
    path: "/invites/redeem",
    async handle({ request, env, ctx, session }) {
      const body = await readJsonObject(request);
      const token = nonEmptyText(body.token, "邀请令牌", 300);
      const redeemed = await redeemRoomInvite(env, session, token);
      ctx.waitUntil(writeInviteAudit(env, session.userId, redeemed.campaignSlug));
      return json(redeemed);
    },
  },
];
