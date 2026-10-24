import { json, nonEmptyText, readJsonObject } from "../http";
import { createCampaignJournal, deleteCampaignJournal, listCampaignJournals, updateCampaignJournal } from "../repository";
import type { CampaignRoute } from "./router";

// 50,000 CJK characters are ~150 KB of UTF-8 JSON, far above the default 64 KB
// body cap; the content limit itself is enforced by the repository.
const JOURNAL_BODY_BYTES = 256 * 1024;

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
      const body = await readJsonObject(request, JOURNAL_BODY_BYTES);
      const journal = await createCampaignJournal(env, access, journalInput(body));
      return json(journal, { status: 201 });
    },
  },
  {
    methods: ["POST"],
    path: "/journals/:journalId",
    async handle({ request, env, access }, { journalId }) {
      const body = await readJsonObject(request, JOURNAL_BODY_BYTES);
      return json(await updateCampaignJournal(env, access, journalId, journalInput(body)));
    },
  },
  {
    methods: ["DELETE"],
    path: "/journals/:journalId",
    async handle({ env, access }, { journalId }) {
      await deleteCampaignJournal(env, access, journalId);
      return json({ ok: true });
    },
  },
];
