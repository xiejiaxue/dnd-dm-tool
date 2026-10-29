import { MODULES } from "./modules/registry";
import { randomToken, sha256Hex, type Session } from "./auth";
import { isRoomModerator, type RoomRole } from "./domain";
import { HttpError, nonEmptyText } from "./http";
import type { RoomAccess, CampaignModuleSummary } from "./repository";

export async function libraryFor(env: Env, userId: string): Promise<string> {
  const proposed = `library-${userId}`,
    now = Date.now();
  const existing = await env.DB.prepare(
    "SELECT workspace_id FROM user_libraries WHERE user_id=?1",
  )
    .bind(userId)
    .first<{ workspace_id: string }>();
  if (!existing)
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO workspaces(id,slug,name,owner_user_id,created_at,updated_at) VALUES(?1,?1,'我的桌团',?2,?3,?3)`,
      ).bind(proposed, userId, now),
      env.DB.prepare(
        `INSERT OR IGNORE INTO user_libraries(user_id,workspace_id) VALUES(?1,?2)`,
      ).bind(userId, proposed),
    ]);
  const library = await env.DB.prepare(
    "SELECT workspace_id FROM user_libraries WHERE user_id=?1",
  )
    .bind(userId)
    .first<{ workspace_id: string }>();
  if (!library) throw new HttpError(503, "LIBRARY_UNAVAILABLE", "桌团暂不可用");
  const id = library.workspace_id;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES(?1,?2,'owner',?3)`,
    ).bind(id, userId, now),
    env.DB.prepare(
      `INSERT OR IGNORE INTO campaign_modules(id,workspace_id,created_by_user_id,name,description,template_json,created_at,updated_at) VALUES(?1,?2,?3,'空白冒险','', '{"firstSceneName":"起始场景"}',?4,?4)`,
    ).bind(`blank-${id}`, id, userId, now),
    ...MODULES.map((module) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO campaign_modules(id,workspace_id,created_by_user_id,name,description,template_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)`,
      ).bind(`${module.id}-${id}`, id, userId, module.library.name, module.library.description, JSON.stringify({ templateId: module.id }), now),
    ),
  ]);
  return id;
}
export async function userModules(
  env: Env,
  userId: string,
): Promise<CampaignModuleSummary[]> {
  const workspaceId = await libraryFor(env, userId);
  const rows = await env.DB.prepare(
    `SELECT MIN(id) AS id,name,description FROM campaign_modules WHERE workspace_id=?1 AND status='active' AND deleted_at IS NULL GROUP BY name,description,template_json ORDER BY CASE WHEN name='空白冒险' THEN 0 ELSE 1 END,name`,
  )
    .bind(workspaceId)
    .all<CampaignModuleSummary>();
  return rows.results;
}
export async function requireCampaignAccess(
  env: Env,
  userId: string,
  slug: string,
  allowArchived = false,
): Promise<RoomAccess> {
  const row = await env.DB.prepare(
    `SELECT c.id,c.slug,c.name,c.status,c.workspace_id,c.runtime_initialized_at,
    cm.id AS member_id,cm.role,cm.permission_epoch,u.display_name,m.template_json,
    cc.id AS character_id,cc.name AS character_name,cc.color,cc.avatar_url,cc.sheet_json
    FROM campaigns c JOIN campaign_members cm ON cm.campaign_id=c.id JOIN users u ON u.id=cm.user_id
    LEFT JOIN campaign_modules m ON m.id=c.module_id
    LEFT JOIN campaign_character_selections sel ON sel.campaign_id=c.id AND sel.user_id=cm.user_id
    LEFT JOIN campaign_characters cc ON cc.id=sel.character_id AND cc.campaign_id=c.id AND cc.owner_user_id=cm.user_id AND cc.deleted_at IS NULL AND cc.status='active'
    WHERE c.slug=?1 AND (c.deleted_at IS NULL OR ?3=1) AND cm.user_id=?2 AND cm.status='active'`,
  )
    .bind(slug, userId, allowArchived ? 1 : 0)
    .first<Record<string, any>>();
  if (!row)
    throw new HttpError(404, "CAMPAIGN_NOT_FOUND", "找不到战役，或你尚未加入");
  if (!allowArchived && row.status !== "active")
    throw new HttpError(409, "CAMPAIGN_ARCHIVED", "战役已归档，请在大厅恢复");
  let templateId: string | undefined;
  let firstSceneName = "起始场景",
    maxHp = 10;
  try {
    templateId = JSON.parse(row.template_json || "{}").templateId;
    firstSceneName =
      JSON.parse(row.template_json || "{}").firstSceneName || firstSceneName;
  } catch {}
  try {
    maxHp = JSON.parse(row.sheet_json || "{}").maxHp || maxHp;
  } catch {}
  const role = (row.role === "owner" ? "host" : row.role) as RoomRole;
  return {
    roomId: row.id,
    roomSlug: row.slug,
    roomName: row.name,
    roomStatus: row.status === "archived" ? "archived" : "live",
    roomAccessEpoch: 1,
    campaignId: row.id,
    campaignName: row.name,
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    campaignMemberId: row.member_id,
    userId,
    role,
    accessEpoch: row.permission_epoch,
    campaignConfigured: true,
    displayName: row.character_name || row.display_name,
    runtimeInitialized: Boolean(row.runtime_initialized_at),
    firstSceneName,
    templateId,
    ...(row.character_id
      ? {
          characterId: row.character_id,
          characterName: row.character_name,
          characterColor: row.color,
          characterAvatar: row.avatar_url,
          characterMaxHp: maxHp,
        }
      : {}),
  };
}
export async function listUserCampaigns(
  env: Env,
  userId: string,
  archived = false,
) {
  const rows = await env.DB.prepare(
    `SELECT c.id,c.slug,c.name,c.status,c.updated_at AS updatedAt,c.module_id AS moduleId,cm.role,COALESCE(m.name,'空白冒险') AS moduleName
    FROM campaigns c JOIN campaign_members cm ON cm.campaign_id=c.id LEFT JOIN campaign_modules m ON m.id=c.module_id
    WHERE cm.user_id=?1 AND cm.status='active' AND c.deleted_at IS NULL AND c.status=?2 ORDER BY c.updated_at DESC,c.id`,
  )
    .bind(userId, archived ? "archived" : "active")
    .all<Record<string, any>>();
  return rows.results.map((row) => ({
    ...row,
    role: row.role === "owner" ? "host" : row.role,
    campaignName: row.name,
  }));
}
export async function createUserCampaign(
  env: Env,
  session: Pick<Session, "userId">,
  input: { name?: string; moduleId?: string; copyMembersFrom?: string },
): Promise<RoomAccess> {
  const workspaceId = await libraryFor(env, session.userId);
  const moduleId =
    input.moduleId ?? `blank-${workspaceId}`;
  if (!moduleId) throw new HttpError(400, "MODULE_REQUIRED", "请选择模组");
  const module = await env.DB.prepare(
    `SELECT id,name FROM campaign_modules WHERE id=?1 AND workspace_id=?2 AND status='active' AND deleted_at IS NULL`,
  )
    .bind(moduleId, workspaceId)
    .first<{ id: string; name: string }>();
  if (!module) throw new HttpError(404, "MODULE_NOT_FOUND", "找不到该模组");
  const name = nonEmptyText(input.name?.trim() || module.name, "战役名称");
  let copy: RoomAccess | undefined;
  if (input.copyMembersFrom) {
    copy = await requireCampaignAccess(
      env,
      session.userId,
      input.copyMembersFrom,
      true,
    );
    if (copy.role !== "host")
      throw new HttpError(403, "FORBIDDEN", "只有战役创建者可复制名册");
  }
  const id = crypto.randomUUID(),
    memberId = crypto.randomUUID(),
    now = Date.now();
  const base =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "campaign";
  const slug = `${base}-${randomToken(8).toLowerCase()}`;
  const statements = [
    env.DB.prepare(
      `INSERT INTO campaigns(id,workspace_id,created_by_user_id,name,module_id,slug,settings_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,'{"configured":true}',?7,?7)`,
    ).bind(id, workspaceId, session.userId, name, module.id, slug, now),
    env.DB.prepare(
      `INSERT INTO campaign_members(id,campaign_id,user_id,role,status,joined_at) VALUES(?1,?2,?3,'owner','active',?4)`,
    ).bind(memberId, id, session.userId, now),
  ];
  if (copy)
    statements.push(
      env.DB.prepare(
        `INSERT INTO campaign_members(id,campaign_id,user_id,role,status,joined_at)
    SELECT 'cm-'||?1||'-'||user_id,?1,user_id,role,'active',?3 FROM campaign_members WHERE campaign_id=?2 AND status='active' AND role IN ('dm','assistant_dm','player','spectator') AND user_id!=?4`,
      ).bind(id, copy.campaignId, now, session.userId),
    );
  await env.DB.batch(statements);
  return requireCampaignAccess(env, session.userId, slug);
}
export async function createCampaignInvite(
  env: Env,
  access: RoomAccess,
  input: { role: unknown; maxUses?: unknown },
) {
  if (!isRoomModerator(access.role))
    throw new HttpError(403, "FORBIDDEN", "只有主持人可邀请");
  const role = input.role ?? "player";
  if (role !== "player" && role !== "spectator")
    throw new HttpError(400, "INVALID_INPUT", "邀请角色只能是玩家或旁观者");
  const maxUses = input.maxUses ?? 1;
  if (
    typeof maxUses !== "number" ||
    !Number.isInteger(maxUses) ||
    maxUses < 1 ||
    maxUses > 50
  )
    throw new HttpError(400, "INVALID_INPUT", "邀请次数必须为 1–50");
  const token = randomToken(32),
    now = Date.now(),
    expiresAt = now + 7 * 86400000;
  await env.DB.prepare(
    `INSERT INTO invites(id,scope_type,scope_id,campaign_id,created_by_user_id,grant_role,token_hash,max_uses,created_at,expires_at)
    VALUES(?1,'campaign',?2,?2,?3,?4,?5,?6,?7,?8)`,
  )
    .bind(
      crypto.randomUUID(),
      access.campaignId,
      access.userId,
      role,
      await sha256Hex(token),
      maxUses,
      now,
      expiresAt,
    )
    .run();
  return {
    inviteUrl: `/c/${encodeURIComponent(access.roomSlug)}#invite=${token}`,
    expiresAt,
  };
}
export async function redeemCampaignInvite(
  env: Env,
  session: Session,
  token: string,
) {
  const now = Date.now();
  const invite = await env.DB.prepare(
    `SELECT i.*,c.slug FROM invites i JOIN campaigns c ON c.id=i.campaign_id WHERE i.token_hash=?1 AND i.scope_type='campaign' AND c.status='active' AND c.deleted_at IS NULL`,
  )
    .bind(await sha256Hex(token))
    .first<Record<string, any>>();
  if (!invite || !["player", "spectator"].includes(invite.grant_role))
    throw new HttpError(404, "INVITE_NOT_FOUND", "邀请无效");
  const member = await env.DB.prepare(
    "SELECT id,status FROM campaign_members WHERE campaign_id=?1 AND user_id=?2",
  )
    .bind(invite.campaign_id, session.userId)
    .first<{ id: string; status: string }>();
  const prior = await env.DB.prepare(
    "SELECT id FROM invite_redemptions WHERE invite_id=?1 AND user_id=?2",
  )
    .bind(invite.id, session.userId)
    .first();
  if (prior && member?.status === "active")
    return { campaignSlug: invite.slug };
  if (member && member.status !== "active")
    throw new HttpError(403, "MEMBERSHIP_REMOVED", "该战役成员资格已被撤销");
  if (
    prior ||
    invite.revoked_at ||
    (invite.expires_at && invite.expires_at <= now)
  )
    throw new HttpError(404, "INVITE_NOT_FOUND", "邀请无效或已过期");
  const redemptionId = crypto.randomUUID(),
    memberId = member?.id ?? crypto.randomUUID();
  // Insert the unique redemption and consume its use in one D1 transaction.
  // All following statements are guarded by the inserted redemption ID.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO invite_redemptions(id,invite_id,user_id,redeemed_at)
      SELECT ?1,id,?2,?3 FROM invites WHERE id=?4 AND EXISTS(SELECT 1 FROM campaigns c WHERE c.id=invites.campaign_id AND c.status='active' AND c.deleted_at IS NULL) AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?3) AND (max_uses IS NULL OR used_count<max_uses)`,
    ).bind(redemptionId, session.userId, now, invite.id),
    env.DB.prepare(
      `UPDATE invites SET used_count=used_count+1 WHERE id=?1 AND EXISTS(SELECT 1 FROM invite_redemptions WHERE id=?2)`,
    ).bind(invite.id, redemptionId),
    env.DB.prepare(
      `INSERT OR IGNORE INTO campaign_members(id,campaign_id,user_id,role,status,joined_at)
      SELECT ?1,?2,?3,?4,'active',?5 WHERE EXISTS(SELECT 1 FROM invite_redemptions WHERE id=?6)`,
    ).bind(
      memberId,
      invite.campaign_id,
      session.userId,
      invite.grant_role,
      now,
      redemptionId,
    ),
    env.DB.prepare(
      `UPDATE invite_redemptions SET campaign_member_id=(SELECT id FROM campaign_members WHERE campaign_id=?1 AND user_id=?2) WHERE id=?3`,
    ).bind(invite.campaign_id, session.userId, redemptionId),
  ]);
  const redeemed = await env.DB.prepare(
    `SELECT cm.status FROM invite_redemptions ir JOIN campaign_members cm ON cm.id=ir.campaign_member_id WHERE ir.invite_id=?1 AND ir.user_id=?2`,
  )
    .bind(invite.id, session.userId)
    .first<{ status: string }>();
  if (redeemed?.status !== "active")
    throw new HttpError(409, "INVITE_EXHAUSTED", "邀请已用完或成员资格被撤销");
  return { campaignSlug: invite.slug };
}
export async function campaignMembers(env: Env, access: RoomAccess) {
  if (!isRoomModerator(access.role))
    throw new HttpError(403, "FORBIDDEN", "只有主持人可查看名册");
  return (
    await env.DB.prepare(
      `SELECT cm.id,u.display_name AS name,cm.role,cm.status FROM campaign_members cm JOIN users u ON u.id=cm.user_id WHERE campaign_id=?1 ORDER BY cm.joined_at`,
    )
      .bind(access.campaignId)
      .all()
  ).results;
}
export async function removeCampaignMember(
  env: Env,
  access: RoomAccess,
  memberId: string,
) {
  if (!isRoomModerator(access.role))
    throw new HttpError(403, "FORBIDDEN", "没有移除权限");
  const target = await env.DB.prepare(
    "SELECT role FROM campaign_members WHERE id=?1 AND campaign_id=?2",
  )
    .bind(memberId, access.campaignId)
    .first<{ role: string }>();
  if (!target) throw new HttpError(404, "MEMBER_NOT_FOUND", "找不到成员");
  if (
    target.role === "owner" ||
    (access.role !== "host" && !["player", "spectator"].includes(target.role))
  )
    throw new HttpError(403, "FORBIDDEN", "不能移除此成员");
  await env.DB.prepare(
    `UPDATE campaign_members SET status='removed',permission_epoch=permission_epoch+1,removed_at=?3 WHERE id=?1 AND campaign_id=?2 AND status!='removed'`,
  )
    .bind(memberId, access.campaignId, Date.now())
    .run();
}
export async function setCampaignStatus(
  env: Env,
  access: RoomAccess,
  status: "active" | "archived",
) {
  if (access.role !== "host")
    throw new HttpError(403, "FORBIDDEN", "只有战役创建者可管理归档");
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE campaigns SET status=?2,updated_at=?3,deleted_at=NULL WHERE id=?1",
    ).bind(access.campaignId, status, now),
    env.DB.prepare(
      "UPDATE campaign_members SET permission_epoch=permission_epoch+1 WHERE campaign_id=?1",
    ).bind(access.campaignId),
  ]);
}
