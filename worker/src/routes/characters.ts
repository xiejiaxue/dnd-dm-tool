import { json, nonEmptyText, readJsonObject } from "../http";
import {
  addSelectedCharacterEntry,
  callRoom,
  createCampaignCharacter,
  getSelectedCharacterSheet,
  listCampaignCharacters,
  removeSelectedCharacterEntry,
  requireRoomAccess,
  selectCampaignCharacter,
} from "../repository";
import { optionalText } from "./fields";
import type { CampaignRoute } from "./router";

export const characterRoutes: CampaignRoute[] = [
  {
    methods: ["GET"],
    path: "/character-sheet",
    async handle({ env, access }) {
      return json(await getSelectedCharacterSheet(env, access));
    },
  },
  {
    methods: ["POST"],
    path: "/character-sheet/entries",
    async handle({ request, env, access }) {
      const body = await readJsonObject(request);
      return json(
        await addSelectedCharacterEntry(env, access, {
          type: nonEmptyText(body.type, "资料类型", 40),
          entryId: nonEmptyText(body.entryId, "资料 ID", 300),
          name: nonEmptyText(body.name, "资料名称", 160),
          source: typeof body.source === "string" ? body.source : undefined,
        }),
        { status: 201 },
      );
    },
  },
  {
    methods: ["DELETE"],
    path: "/character-sheet/entries/:entryId",
    async handle({ env, access }, { entryId }) {
      await removeSelectedCharacterEntry(env, access, entryId);
      return json({ ok: true });
    },
  },
  {
    methods: ["GET"],
    path: "/characters",
    async handle({ request, env, access }) {
      const campaignId =
        new URL(request.url).searchParams.get("campaignId") ??
        access.campaignId;
      return json(await listCampaignCharacters(env, access, campaignId));
    },
  },
  {
    methods: ["POST"],
    path: "/characters",
    async handle({ request, env, access }) {
      const body = await readJsonObject(request);
      const character = await createCampaignCharacter(env, access, {
        campaignId: nonEmptyText(body.campaignId, "战役 ID", 180),
        name: nonEmptyText(body.name, "角色名称"),
        color: optionalText(body.color, "角色颜色"),
        maxHp: typeof body.maxHp === "number" ? body.maxHp : undefined,
      });
      return json(character, { status: 201 });
    },
  },
  {
    methods: ["POST"],
    path: "/characters/:characterId/select",
    async handle({ request, env, access }, { characterId }) {
      const body = await readJsonObject(request);
      const campaignId = nonEmptyText(body.campaignId, "战役 ID", 180);
      const character = await selectCampaignCharacter(
        env,
        access,
        campaignId,
        characterId,
      );
      const refreshed = await requireRoomAccess(
        env,
        access.userId,
        access.roomSlug,
      );
      if (campaignId === refreshed.campaignId && refreshed.role === "player") {
        const response = await callRoom(
          env,
          refreshed,
          "POST",
          "/characters/provision",
        );
        if (!response.ok) return response;
      }
      return json(character);
    },
  },
];
