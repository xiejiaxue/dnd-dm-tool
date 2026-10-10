import { resolveFogBasisScale } from '../../shared/fog';
import type { Campaign, ChatMessage, Scene } from "../../shared/types";
import type { PersistedRoomState } from "./domain";

/** Small metadata row + one row per scene + append-only message rows. */
export class CampaignStore {
  constructor(private storage: DurableObjectStorage) {
    for (const sql of [
      "CREATE TABLE IF NOT EXISTS campaign_runtime(singleton INTEGER PRIMARY KEY CHECK(singleton=1),campaign_id TEXT NOT NULL,revision INTEGER NOT NULL,current_scene_id TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS campaign_data(id TEXT PRIMARY KEY,data_json TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS scene_data(id TEXT PRIMARY KEY,data_json TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS chat_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,data_json TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS command_receipts(actor_member_id TEXT NOT NULL,command_id TEXT NOT NULL,revision INTEGER NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(actor_member_id,command_id))",
      "CREATE TABLE IF NOT EXISTS fog_legacy_backup(scene_id TEXT PRIMARY KEY,data_json TEXT NOT NULL,created_at INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS campaign_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,actor_member_id TEXT NOT NULL,command_id TEXT NOT NULL,action TEXT NOT NULL,revision INTEGER NOT NULL,created_at INTEGER NOT NULL)",
    ])
      storage.sql.exec(sql);
  }
  load(): PersistedRoomState | null {
    const meta = this.storage.sql
      .exec<{
        campaign_id: string;
        revision: number;
        current_scene_id: string;
      }>("SELECT * FROM campaign_runtime WHERE singleton=1")
      .toArray()[0];
    if (!meta) return null;
    const campaign = this.storage.sql
      .exec<{
        data_json: string;
      }>("SELECT data_json FROM campaign_data WHERE id=?1", meta.campaign_id)
      .toArray()[0];
    if (!campaign) throw new Error("Missing campaign state");
    const scenes = Object.fromEntries(
      this.storage.sql
        .exec<{ id: string; data_json: string }>(
          "SELECT id,data_json FROM scene_data",
        )
        .toArray()
        .map((row) => {
          const scene = JSON.parse(row.data_json) as Scene;
          if (scene.fogBasisScale === undefined) {
            scene.fogBasisScale = resolveFogBasisScale(scene);
            this.storage.transactionSync(() => {
              if (scene.fog?.length) this.storage.sql.exec('INSERT OR IGNORE INTO fog_legacy_backup(scene_id,data_json,created_at) VALUES(?1,?2,?3)', row.id, row.data_json, Date.now());
              this.storage.sql.exec('UPDATE scene_data SET data_json=?1 WHERE id=?2', JSON.stringify(scene), row.id);
            });
          }
          return [row.id, scene];
        }),
    );
    const messages = this.storage.sql
      .exec<{ data_json: string }>(
        "SELECT data_json FROM chat_messages ORDER BY seq",
      )
      .toArray()
      .map((row) => JSON.parse(row.data_json) as ChatMessage);
    return {
      schemaVersion: 2,
      revision: meta.revision,
      currentSceneId: meta.current_scene_id,
      campaign: JSON.parse(campaign.data_json) as Campaign,
      scenes,
      messages,
    };
  }
  save(next: PersistedRoomState, prior?: PersistedRoomState): void {
    this.storage.sql.exec(
      "INSERT INTO campaign_runtime(singleton,campaign_id,revision,current_scene_id) VALUES(1,?1,?2,?3) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,current_scene_id=excluded.current_scene_id",
      next.campaign.id,
      next.revision,
      next.currentSceneId,
    );
    if (next.campaign !== prior?.campaign)
      this.storage.sql.exec(
        "INSERT INTO campaign_data(id,data_json) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json",
        next.campaign.id,
        JSON.stringify(next.campaign),
      );
    for (const [id, scene] of Object.entries(next.scenes))
      if (scene !== prior?.scenes[id])
        this.storage.sql.exec(
          "INSERT INTO scene_data(id,data_json) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json",
          id,
          JSON.stringify(scene),
        );
    for (const id of Object.keys(prior?.scenes ?? {}))
      if (!next.scenes[id])
        this.storage.sql.exec("DELETE FROM scene_data WHERE id=?1", id);
    if (next.messages !== prior?.messages) {
      const known = new Set(prior?.messages.map((message) => message.id) ?? []);
      for (const message of next.messages)
        if (!known.has(message.id))
          this.storage.sql.exec(
            "INSERT OR IGNORE INTO chat_messages(id,data_json) VALUES(?1,?2)",
            message.id,
            JSON.stringify(message),
          );
      this.storage.sql.exec(
        "DELETE FROM chat_messages WHERE seq NOT IN (SELECT seq FROM chat_messages ORDER BY seq DESC LIMIT 500)",
      );
    }
  }
}
