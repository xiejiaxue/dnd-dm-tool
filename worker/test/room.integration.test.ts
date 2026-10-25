import { env } from "cloudflare:workers";
import { SELF, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CampaignStore } from "../src/campaign-store";
import migration from "../campaign-migrations/0001_campaign_core.sql?raw";
const statements = migration
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);
const api = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`https://table.test${path}`, init);
const headers = (cookie: string) => ({
  cookie,
  origin: "https://table.test",
  "content-type": "application/json",
});
const post = (path: string, cookie: string, body: unknown = {}) =>
  api(path, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify(body),
  });
const get = (path: string, cookie: string) =>
  api(path, { headers: headers(cookie) });
async function visitor() {
  const r = await api("/api/me");
  return r.headers.get("set-cookie")!.split(";")[0];
}
async function create(cookie: string, body: unknown = {}) {
  const r = await post("/api/campaigns", cookie, body);
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as any).campaign;
}
async function invite(cookie: string, slug: string, role = "player") {
  const r = await post(`/api/campaigns/${slug}/invites`, cookie, { role });
  expect(r.status).toBe(201);
  return new URL(
    ((await r.json()) as any).inviteUrl,
    "https://table.test",
  ).hash.slice(8);
}
const join = (cookie: string, token: string) =>
  post("/api/invites/redeem", cookie, { token });
const boot = async (cookie: string, slug: string) =>
  (await get(`/api/campaigns/${slug}`, cookie)).json() as Promise<any>;
async function character(cookie: string, c: any) {
  const r = await post(`/api/campaigns/${c.slug}/characters`, cookie, {
    campaignId: c.id,
    name: "莱拉",
    maxHp: 18,
  });
  expect(r.status).toBe(201);
  const pc = (await r.json()) as any;
  expect(
    (
      await post(
        `/api/campaigns/${c.slug}/characters/${pc.id}/select`,
        cookie,
        { campaignId: c.id },
      )
    ).status,
  ).toBe(200);
  return pc;
}
beforeEach(async () => {
  for (const sql of statements) await env.DB.prepare(sql).run();
});
afterEach(async () => {
  await reset();
});
describe("Campaign control plane", () => {
  it("loads 21 map-only scenes, isolates campaigns and preserves initialized state", async () => {
    const prefix = 'room-templates/waterdeep-dragon-heist/';
    const scenes = Array.from({ length: 21 }, (_, i) => ({
      name: `章节 ${i + 1}`, map: { assetId: `map-${i}`, width: 1438, height: 868, mapScale: 3 },
      tokens: [{ name: 'excluded encounter' }],
    }));
    await env.REFERENCE_DATA.put(`${prefix}manifest.json`, JSON.stringify({ scenes, npcs: [{ name: 'excluded NPC' }] }));
    for (const scene of scenes) await env.REFERENCE_DATA.put(`${prefix}assets/${scene.map.assetId}`, 'image', { httpMetadata: { contentType: 'image/jpeg' } });
    const cookie = await visitor();
    const modules = await (await get('/api/modules', cookie)).json() as any[];
    expect(modules).toHaveLength(6);
    const moduleId = modules.find(m => m.name === '深水城：龙金劫').id;
    const a = await create(cookie, { moduleId }), b = await create(cookie, { moduleId });
    const first = (await boot(cookie, a.slug)).state;
    const second = (await boot(cookie, b.slug)).state;
    expect(first.campaign.sceneIds).toHaveLength(21);
    expect(second.campaign.sceneIds).toHaveLength(21);
    expect(first.campaign.sceneIds.some((id: string) => second.campaign.sceneIds.includes(id))).toBe(false);
    const stored = await runInDurableObject(env.ROOMS.getByName(`campaign:${a.id}`), (_instance, state) => new CampaignStore(state.storage).load());
    expect(Object.values(stored!.scenes).map(s => s.name)).toEqual(scenes.map(s => s.name));
    for (const scene of Object.values(stored!.scenes)) {
      expect(scene.tokens).toEqual([]);
      expect(scene.mapSize).toEqual([1438, 868]);
      expect(scene.mapScale).toBe(3);
      expect((await get(scene.mapImage!, cookie)).status).toBe(200);
    }
    expect((await get(second.scene.mapImage, cookie)).status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM assets").first("n")).toBe(42);
    expect(first.campaign.enemies).toEqual([]);
    expect((await get(first.scene.mapImage, await visitor())).status).toBe(404);
    expect((await get(first.scene.mapImage.replace(a.slug, b.slug), cookie)).status).toBe(404);
    await post(`/api/campaigns/${a.slug}/scenes`, cookie, { name: '追加场景' });
    await env.DB.prepare('UPDATE campaigns SET runtime_initialized_at=NULL WHERE id=?1').bind(a.id).run();
    expect((await boot(cookie, a.slug)).state.campaign.sceneIds).toHaveLength(22);
    expect((await boot(cookie, b.slug)).state.campaign.sceneIds).toHaveLength(21);
  });
  it("does not initialize a partial template when a map is missing", async () => {
    const cookie = await visitor();
    const modules = await (await get('/api/modules', cookie)).json() as any[];
    const moduleId = modules.find(m => m.name === '深水城：龙金劫').id;
    await env.REFERENCE_DATA.put('room-templates/waterdeep-dragon-heist/manifest.json', JSON.stringify({
      scenes: Array.from({ length: 21 }, () => ({ name: 'missing', map: { assetId: 'map-missing', width: 100, height: 100 } })),
    }));
    expect((await post('/api/campaigns', cookie, { moduleId })).status).toBe(503);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM campaigns WHERE runtime_initialized_at IS NOT NULL').first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM assets').first('n')).toBe(0);
  });

  it("serves public config without creating a session", async () => {
    const r = await api("/api/public-config");
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toBeNull();
  });
  it("creates initialized isolated campaigns using one library and module", async () => {
    const cookie = await visitor(),
      a = await create(cookie),
      b = await create(cookie, { name: "Second season" });
    expect(a.name).toBe("空白冒险");
    const initial = await boot(cookie, a.slug);
    expect(initial.state).toMatchObject({
      type: "state",
      role: "dm",
      revision: 0,
    });
    expect(initial.state.campaign.sceneIds).toHaveLength(1);
    const scene = await post(`/api/campaigns/${a.slug}/scenes`, cookie, {
      name: "The crypt",
    });
    expect(scene.status).toBe(201);
    expect((await boot(cookie, a.slug)).state.campaign.sceneIds).toHaveLength(
      2,
    );
    expect((await boot(cookie, b.slug)).state.campaign.sceneIds).toHaveLength(
      1,
    );
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM workspaces").first("n"),
    ).toBe(1);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM campaign_modules").first(
        "n",
      ),
    ).toBe(6);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='rooms'",
      ).first("n"),
    ).toBe(0);
  });
  it("consumes a single-use invitation once under concurrent redemption and allows retry by its winner", async () => {
    const host = await visitor(),
      c = await create(host),
      token = await invite(host, c.slug),
      a = await visitor(),
      b = await visitor();
    expect((await get(`/api/campaigns/${c.slug}`, a)).status).toBe(404);
    const responses = await Promise.all([join(a, token), join(b, token)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = responses[0].status === 200 ? a : b;
    expect((await join(winner, token)).status).toBe(200);
    expect(
      await env.DB.prepare("SELECT used_count FROM invites").first(
        "used_count",
      ),
    ).toBe(1);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM workspace_members").first(
        "n",
      ),
    ).toBe(1);
    expect((await boot(winner, c.slug)).state.campaign.enemies).toEqual([]);
  });
  it("restores the selected PC per campaign and copies only the roster into a new season", async () => {
    const host = await visitor(),
      player = await visitor(),
      c = await create(host);
    expect((await join(player, await invite(host, c.slug))).status).toBe(200);
    const pc = await character(player, c);
    expect((await boot(player, c.slug)).selectedCharacter.id).toBe(pc.id);
    const next = await create(host, {
      name: "Season 2",
      copyMembersFrom: c.slug,
    });
    const fresh = await boot(player, next.slug);
    expect(fresh.selectedCharacter).toBeNull();
    expect(fresh.state.campaign.sceneIds).toHaveLength(1);
    expect(
      await (
        await get(`/api/campaigns/${next.slug}/characters`, player)
      ).json(),
    ).toEqual([]);
    expect(
      (
        await post(
          `/api/campaigns/${next.slug}/characters/${pc.id}/select`,
          player,
          { campaignId: next.id },
        )
      ).status,
    ).toBe(404);
    expect((await boot(player, c.slug)).selectedCharacter.id).toBe(pc.id);
  });
  it("denies players before choosing a PC and immediately revokes a connected member", async () => {
    const host = await visitor(),
      player = await visitor(),
      c = await create(host),
      token = await invite(host, c.slug);
    await join(player, token);
    const connect = () =>
      api(`/api/campaigns/${c.slug}/ws`, {
        headers: { ...headers(player), upgrade: "websocket" },
      });
    expect((await connect()).status).toBe(403);
    await character(player, c);
    const response = await connect();
    expect(response.status).toBe(101);
    const ws = response.webSocket!;
    ws.accept();
    const closed = new Promise<number>((resolve) =>
      ws.addEventListener("close", (e) => {
        ws.close();
        resolve(e.code);
      }),
    );
    const members = (await (
      await get(`/api/campaigns/${c.slug}/members`, host)
    ).json()) as any;
    const member = members.members.find((m: any) => m.role === "player");
    expect(
      (
        await api(`/api/campaigns/${c.slug}/members/${member.id}`, {
          method: "DELETE",
          headers: headers(host),
        })
      ).status,
    ).toBe(200);
    expect(await closed).toBe(4003);
    expect((await connect()).status).toBe(404);
    expect((await join(player, token)).status).toBe(403);
    expect(
      await env.DB.prepare(
        "SELECT permission_epoch FROM campaign_members WHERE id=?1",
      )
        .bind(member.id)
        .first("permission_epoch"),
    ).toBe(2);
  });
  it("archives, restores and soft deletes without losing scene data", async () => {
    const host = await visitor(),
      c = await create(host);
    const initial = await boot(host, c.slug);
    expect((await post(`/api/campaigns/${c.slug}/archive`, host)).status).toBe(
      200,
    );
    expect((await get(`/api/campaigns/${c.slug}`, host)).status).toBe(409);
    expect(
      ((await (await get("/api/campaigns", host)).json()) as any).campaigns,
    ).toHaveLength(0);
    expect(
      (
        (await (
          await get("/api/campaigns?status=archived", host)
        ).json()) as any
      ).campaigns,
    ).toHaveLength(1);
    expect((await post(`/api/campaigns/${c.slug}/restore`, host)).status).toBe(
      200,
    );
    expect((await boot(host, c.slug)).state.campaign.sceneIds).toEqual(
      initial.state.campaign.sceneIds,
    );
    expect(
      (
        await api(`/api/campaigns/${c.slug}`, {
          method: "DELETE",
          headers: headers(host),
        })
      ).status,
    ).toBe(200);
    expect((await get(`/api/campaigns/${c.slug}`, host)).status).toBe(404);
    expect(
      await env.DB.prepare("SELECT deleted_at FROM campaigns WHERE id=?1")
        .bind(c.id)
        .first("deleted_at"),
    ).toBeGreaterThan(0);
  });
  it("provisions online players atomically when changing scenes without duplicating tabs", async () => {
    const host = await visitor(), player = await visitor(), spectator = await visitor();
    const campaign = await create(host);
    await join(player, await invite(host, campaign.slug));
    await join(spectator, await invite(host, campaign.slug, "spectator"));
    const pc = await character(player, campaign);
    const original = (await boot(host, campaign.slug)).state.scene;
    const destination = await (await post(`/api/campaigns/${campaign.slug}/scenes`, host, { name: "Next room" })).json() as any;
    const sockets: WebSocket[] = [];
    for (const cookie of [host, player, player, spectator]) {
      const response = await api(`/api/campaigns/${campaign.slug}/ws`, {
        headers: { ...headers(cookie), upgrade: "websocket" },
      });
      expect(response.status).toBe(101);
      const ws = response.webSocket!;
      ws.accept();sockets.push(ws);
    }
    const waitScene = (ws: WebSocket, sceneId: string) => new Promise<any>((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        const data = JSON.parse(String(event.data));
        if (data.type === "error") { ws.removeEventListener("message", handler); reject(new Error(data.message)); }
        if (data.type === "state" && data.scene.id === sceneId) { ws.removeEventListener("message", handler); resolve(data.scene); }
      };
      ws.addEventListener("message", handler);
    });
    try {
      const arriving = sockets.map(ws => waitScene(ws, destination.id));
      sockets[0].send(JSON.stringify({ type: "switchScene", sceneId: destination.id }));
      for (const scene of await Promise.all(arriving)) {
        expect(scene.players).toHaveLength(1);
        expect(scene.players[0]).toMatchObject({ id: `character-${pc.id}`, name: pc.name });
        expect(scene.tokens).toEqual([]);
      }
      const restored = await runInDurableObject(env.ROOMS.getByName(`campaign:${campaign.id}`), (_instance, state) => new CampaignStore(state.storage).load());
      expect(restored!.scenes[destination.id].players).toHaveLength(1);
      expect(restored!.scenes[original.id].players).toEqual(original.players);
      const returning = waitScene(sockets[1], original.id);
      sockets[0].send(JSON.stringify({ type: "switchScene", sceneId: original.id }));
      expect((await returning).players).toHaveLength(1);
      const fallback = await (await post(`/api/campaigns/${campaign.slug}/scenes`, host, { name: "Unvisited room" })).json() as any;
      await api(`/api/campaigns/${campaign.slug}/scenes/${destination.id}`, { method: "DELETE", headers: headers(host) });
      const afterDelete = waitScene(sockets[1], fallback.id);
      await api(`/api/campaigns/${campaign.slug}/scenes/${original.id}`, { method: "DELETE", headers: headers(host) });
      expect((await afterDelete).players).toHaveLength(1);
    } finally {
      sockets.forEach(ws => ws.close());
    }
  });
  it("sends chat as small frames that respect visibility and rolls shared notation", async () => {
    const host = await visitor(), player = await visitor(), spectator = await visitor();
    const campaign = await create(host);
    await join(player, await invite(host, campaign.slug));
    await join(spectator, await invite(host, campaign.slug, "spectator"));
    await character(player, campaign);
    const sockets: WebSocket[] = [];
    const frames: any[][] = [];
    for (const cookie of [host, player, spectator]) {
      const response = await api(`/api/campaigns/${campaign.slug}/ws`, { headers: { ...headers(cookie), upgrade: "websocket" } });
      const ws = response.webSocket!;
      ws.accept();
      const list: any[] = [];
      ws.addEventListener("message", (event) => list.push(JSON.parse(String(event.data))));
      ws.send(JSON.stringify({ type: "capabilities", patches: 1 }));
      sockets.push(ws); frames.push(list);
    }
    const chats = (index: number) => frames[index].filter((frame) => frame.type === "chat");
    const settle = async (count: number) => {
      for (let i = 0; i < 50 && frames.some((_, index) => chats(index).length < count); i++) await new Promise((r) => setTimeout(r, 20));
    };
    try {
      await new Promise((r) => setTimeout(r, 50));
      sockets[1].send(JSON.stringify({ type: "chat", id: "secret", text: "/r 2d20kh1+3", visibility: "gm" }));
      await settle(1);
      const [toHost, toPlayer, toSpectator] = [chats(0)[0], chats(1)[0], chats(2)[0]];
      expect(toHost.message).toMatchObject({ kind: "roll", formula: "2d20kh1+3", visibility: "gm" });
      expect(toHost.message.rolls).toHaveLength(2);
      expect(toHost.message.dropped).toHaveLength(1);
      expect(toPlayer.message.id).toBe(toHost.message.id);
      // The spectator only learns that the revision moved on.
      expect(toSpectator).toEqual({ type: "chat", revision: toHost.revision });
      sockets[1].send(JSON.stringify({ type: "chat", id: "bad", text: "/r 2d20kh5", visibility: "public" }));
      for (let i = 0; i < 50 && !frames[1].some((frame) => frame.type === "error"); i++) await new Promise((r) => setTimeout(r, 20));
      expect(frames[1].find((frame) => frame.type === "error").message).toContain("骰子公式无效");
    } finally {
      sockets.forEach((ws) => ws.close());
    }
  });
  it("persists only the affected scene and reconstructs state from SQL", async () => {
    const host = await visitor(),
      c = await create(host);
    await post(`/api/campaigns/${c.slug}/scenes`, host, {
      name: "Other scene",
    });
    const stub = env.ROOMS.getByName(`campaign:${c.id}`);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("CREATE TABLE writes(kind TEXT,id TEXT)");
      state.storage.sql.exec(
        "CREATE TRIGGER scene_write AFTER UPDATE ON scene_data BEGIN INSERT INTO writes VALUES('scene',new.id); END",
      );
      state.storage.sql.exec(
        "CREATE TRIGGER campaign_write AFTER UPDATE ON campaign_data BEGIN INSERT INTO writes VALUES('campaign',new.id); END",
      );
    });
    const response = await api(`/api/campaigns/${c.slug}/ws`, {
      headers: { ...headers(host), upgrade: "websocket" },
    });
    const ws = response.webSocket!;
    ws.accept();
    const ack = new Promise<void>((resolve, reject) =>
      ws.addEventListener("message", (e) => {
        const data = JSON.parse(String(e.data));
        if (data.type === "ack") resolve();
        if (data.type === "error") reject(new Error(data.message));
      }),
    );
    ws.send(
      JSON.stringify({
        type: "op",
        id: "scale-once",
        ops: [{ op: "updateMapScale", mapScale: 1.5 }, { op: "revealFogRect", rect: { x: 113.25, y: 117.5, width: 6.5, height: 5.25 } }],
      }),
    );
    await ack;
    const writes = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql.exec("SELECT * FROM writes").toArray(),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0].kind).toBe("scene");
    const restored = await runInDurableObject(stub, (_instance, state) =>
      new CampaignStore(state.storage).load(),
    );
    expect(restored!.scenes[restored!.currentSceneId].mapScale).toBe(1.5);
    expect(restored!.scenes[restored!.currentSceneId].fogReveals).toEqual([{x:113.25,y:117.5,width:6.5,height:5.25}]);
    expect(Object.keys(restored!.scenes)).toHaveLength(2);
    ws.close();
  });
  it("limits spectators to read-only access and preserves campaign journals", async () => {
    const host = await visitor(),
      spectator = await visitor(),
      c = await create(host);
    await join(spectator, await invite(host, c.slug, "spectator"));
    expect(
      (
        await post(`/api/campaigns/${c.slug}/scenes`, spectator, {
          name: "Forbidden",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await post(`/api/campaigns/${c.slug}/invites`, spectator, {
          role: "player",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await post(`/api/campaigns/${c.slug}/journals`, host, {
          title: "第一章",
          content: "矿坑入口",
          visibility: "players",
        })
      ).status,
    ).toBe(201);
    expect(
      await (await get(`/api/campaigns/${c.slug}/journals`, spectator)).json(),
    ).toEqual([
      expect.objectContaining({ title: "第一章", content: "矿坑入口" }),
    ]);
    const [journal] = (await (await get(`/api/campaigns/${c.slug}/journals`, host)).json()) as any[];
    const remove = (cookie: string) => api(`/api/campaigns/${c.slug}/journals/${journal.id}`, { method: "DELETE", headers: headers(cookie) });
    expect((await remove(spectator)).status).toBe(403);
    expect((await remove(host)).status).toBe(200);
    expect((await remove(host)).status).toBe(404);
    expect(await (await get(`/api/campaigns/${c.slug}/journals`, spectator)).json()).toEqual([]);
    // A full-length Chinese journal fits the body cap; one character more is refused.
    expect((await post(`/api/campaigns/${c.slug}/journals`, host, { title: "长篇", content: "字".repeat(50_000) })).status).toBe(201);
    expect((await post(`/api/campaigns/${c.slug}/journals`, host, { title: "长篇", content: "字".repeat(50_001) })).status).toBe(400);
  });
  it('persists a recovered legacy fog stride without rewriting revealed bits', async () => {
    const host = await visitor(), campaign = await create(host);
    const stub = env.ROOMS.getByName(`campaign:${campaign.id}`);
    await runInDurableObject(stub, (_instance, state) => {
      const row = state.storage.sql.exec<{id:string;data_json:string}>('SELECT id,data_json FROM scene_data LIMIT 1').toArray()[0];
      const old = JSON.parse(row.data_json);
      old.mapImage = '/api/campaigns/test/assets/map'; old.mapSize = [523,377]; old.mapScale = 2;
      delete old.fogBasisScale; old.fog = Array(88).fill(false);old.fog[25] = true;
      state.storage.sql.exec('UPDATE scene_data SET data_json=?1 WHERE id=?2',JSON.stringify(old),row.id);
      const loaded = new CampaignStore(state.storage).load()!.scenes[row.id];
      expect(loaded.fogBasisScale).toBe(1);expect(loaded.fog).toEqual(old.fog);
      const persisted = JSON.parse(state.storage.sql.exec<{data_json:string}>('SELECT data_json FROM scene_data WHERE id=?1',row.id).toArray()[0].data_json);
      expect(persisted.fogBasisScale).toBe(1);expect(persisted.fog).toEqual(old.fog);
      const backup = JSON.parse(state.storage.sql.exec<{data_json:string}>('SELECT data_json FROM fog_legacy_backup WHERE scene_id=?1',row.id).toArray()[0].data_json);
      expect(backup.fogBasisScale).toBeUndefined();expect(backup.fog).toEqual(old.fog);
    });
  });

});
