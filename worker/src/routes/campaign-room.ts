import { HttpError, json, readJsonObject, requireSameOrigin } from "../http";
import { LEGACY_TEMPLATE_ID, MODULES } from "../modules/registry";
import {
  callRoom,
  createAsset,
  createRoomInvite,
  forwardRoomWebSocket,
  getAsset,
} from "../repository";
import { writeAudit } from "./audit";
import { roomSummary } from "./fields";
import type { CampaignRoute } from "./router";

/** Each registered module route is forwarded unchanged to the campaign's Durable Object. */
const moduleRoutes: CampaignRoute[] = MODULES.flatMap((module) =>
  (module.routes ?? []).map((route): CampaignRoute => ({
    methods: route.methods,
    path: route.param ? `/${route.path}/:param` : `/${route.path}`,
    async handle({ request, env, access }, { param }) {
      const path = `/${route.path}${route.param ? `/${encodeURIComponent(param)}` : ""}`;
      return callRoom(env, access, request.method, path, request.method === "POST" ? await readJsonObject(request) : undefined);
    },
  })),
);

export const campaignRoomRoutes: CampaignRoute[] = [
  {
    methods: ["GET"],
    path: "/",
    async handle({ env, access }) {
      const response = await callRoom(env, access, "GET", "/bootstrap");
      if (!response.ok) return response;
      const payload = (await response.json()) as {
        state?: unknown;
        membership?: unknown;
      };
      return json({
        campaign: roomSummary(access),
        membership: {
          role: access.role,
          roomRole: access.role,
          canManage:
            access.role === "host" ||
            access.role === "dm" ||
            access.role === "assistant_dm",
        },
        state: payload.state,
        selectedCharacter: access.characterId
          ? {
              id: access.characterId,
              campaignId: access.campaignId,
              name: access.characterName,
              color: access.characterColor,
              avatarUrl: access.characterAvatar,
              maxHp: access.characterMaxHp,
            }
          : null,
      });
    },
  },
  {
    methods: ["GET"],
    path: "/ws",
    async handle({ request, env, access }) {
      requireSameOrigin(request);
      return forwardRoomWebSocket(env, access, request);
    },
  },
  {
    methods: ["POST"],
    path: "/invites",
    async handle({ request, env, ctx, access }) {
      const body = await readJsonObject(request);
      const invite = await createRoomInvite(env, access, {
        role: body.role,
        maxUses: body.maxUses,
      });
      ctx.waitUntil(
        writeAudit(env, access, "invite.create", "campaign", access.roomId),
      );
      return json(invite, { status: 201 });
    },
  },
  {
    methods: ["POST"],
    path: "/assets",
    async handle({ request, env, ctx, access }) {
      const declaredLength = Number(request.headers.get("content-length") ?? 0);
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > 11 * 1024 * 1024
      ) {
        throw new HttpError(413, "PAYLOAD_TOO_LARGE", "图片必须小于 10 MiB");
      }
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        throw new HttpError(400, "INVALID_INPUT", "需要上传图片文件");
      const asset = await createAsset(env, access, file, form.get("kind"));
      ctx.waitUntil(writeAudit(env, access, "asset.upload", "asset", asset.id));
      return json(asset, { status: 201 });
    },
  },
  {
    methods: ["GET"],
    path: "/assets/:assetId",
    async handle({ env, access }, { assetId }) {
      const asset = await getAsset(env, access, assetId);
      const headers = new Headers({
        "content-type": asset.metadata.content_type,
        "content-length": String(asset.metadata.byte_size),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-disposition": "inline",
      });
      return new Response(asset.object.body, { headers });
    },
  },
  ...moduleRoutes,
  {
    methods: ["GET"],
    path: "/notes",
    async handle({ request, env, access }) {
      // The room only sees this access-derived module id, never one from the client.
      const params = new URLSearchParams({
        q: (new URL(request.url).searchParams.get("q") ?? "").slice(0, 100),
        module: access.templateId ?? LEGACY_TEMPLATE_ID,
      });
      return callRoom(env, access, "GET", `/notes?${params}`);
    },
  },
  {
    methods: ["GET", "POST"],
    path: "/scenes",
    async handle({ request, env, access }) {
      return callRoom(
        env,
        access,
        request.method,
        "/scenes",
        request.method === "POST" ? await readJsonObject(request) : undefined,
      );
    },
  },
  {
    methods: ["GET", "DELETE"],
    path: "/scenes/:sceneId",
    async handle({ request, env, access }, { sceneId }) {
      return callRoom(
        env,
        access,
        request.method,
        `/scenes/${encodeURIComponent(sceneId)}`,
      );
    },
  },
];
