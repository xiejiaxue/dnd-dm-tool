import { calendarPayload } from "../calendar";
import { requireCampaignAccess } from "../campaigns";
import { json } from "../http";
import type { ApiContext, Route } from "./router";

export const calendarRoutes: Route<ApiContext>[] = [
  {
    methods: ["GET"],
    path: "/calendar",
    async handle({ env, session, url }) {
      const slug = url.searchParams.get("campaign");
      const access = slug ? await requireCampaignAccess(env, session.userId, slug) : null;
      return json(calendarPayload(access?.role ?? null));
    },
  },
];
