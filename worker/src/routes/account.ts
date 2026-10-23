import { revokeCurrentSession } from "../auth";
import { json } from "../http";
import type { ApiContext, Route } from "./router";

export const accountRoutes: Route<ApiContext>[] = [
  {
    methods: ["GET"],
    path: "/me",
    async handle({ session }) {
      return json({
        id: session.userId,
        displayName: session.displayName,
        isAnonymous: true,
      });
    },
  },
  {
    methods: ["POST"],
    path: "/auth/logout",
    async handle({ env, session, request }) {
      await revokeCurrentSession(env, session);
      return json(
        { ok: true },
        { headers: { "set-cookie": expiredSessionCookie(request) } },
      );
    },
  },
];

function expiredSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:";
  return `${secure ? "__Host-dnd-session" : "dnd_session"}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
