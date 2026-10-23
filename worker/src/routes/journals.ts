import { json, nonEmptyText, readJsonObject } from "../http";
import { createCampaignJournal, listCampaignJournals, updateCampaignJournal } from "../repository";
import type { CampaignRoute } from "./router";

function journalInput(body: Record<string, unknown>) {
  return {
    title: nonEmptyText(body.title, "日志标题", 160),
    content: typeof body.content === "string" ? body.content : undefined,
    visibility:
      typeof body.visibility === "string" ? body.visibility : undefined,
  };
}

export const journalRoutes: CampaignRoute[] = [
  {
    methods: ["GET"],
    path: "/journals",
    async handle({ env, access }) {
      return json(await listCampaignJournals(env, access));
    },
  },
  {
    methods: ["POST"],
    path: "/journals",
    async handle({ request, env, access }) {
      const body = await readJsonObject(request);
      const journal = await createCampaignJournal(env, access, journalInput(body));
      return json(journal, { status: 201 });
    },
  },
  {
    methods: ["POST"],
    path: "/journals/:journalId",
    async handle({ request, env, access }, { journalId }) {
      const body = await readJsonObject(request);
      return json(await updateCampaignJournal(env, access, journalId, journalInput(body)));
    },
  },
];
