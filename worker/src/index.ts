import { getOrCreateSession, type SessionContext } from "./auth";
import { errorResponse, json, requestId, requireSameOrigin, withSetCookie } from "./http";
import { OnlineCompendiumRateLimitDurableObject } from "./online-compendium";
import { getPublicSiteConfig } from "./public-config";
import { routeApi } from "./routes";

export { RoomDurableObject } from "./room";
export { OnlineCompendiumRateLimitDurableObject };

const worker: ExportedHandler<Env> = {
  async fetch(request, env, ctx): Promise<Response> {
    const id = requestId(request);
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      // Static Assets handles non-API paths (including /c/:slug SPA routes).
      // This branch is a defensive fallback for a worker-first route override.
      return new Response("Not found", { status: 404 });
    }

    let sessionContext: SessionContext | undefined;
    try {
      if (url.pathname === "/api/health")
        return json({ ok: true, runtime: "cloudflare-worker" });
      // This endpoint must not create an anonymous session merely to render a
      // legal footer.  It contains only explicitly configured public strings.
      if (url.pathname === "/api/public-config" && request.method === "GET") {
        return json(getPublicSiteConfig(env), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method))
        requireSameOrigin(request);
      sessionContext = await getOrCreateSession(env, request);
      const response = await routeApi({
        request,
        env,
        ctx,
        session: sessionContext.session,
        url,
      });
      console.log(
        JSON.stringify({
          event: "api_request",
          requestId: id,
          method: request.method,
          path: url.pathname,
          status: response.status,
        }),
      );
      return withSetCookie(response, sessionContext.setCookie);
    } catch (error) {
      return withSetCookie(errorResponse(error, id), sessionContext?.setCookie);
    }
  },
};

export default worker;
