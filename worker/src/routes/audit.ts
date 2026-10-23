import { requireCampaignAccess } from "../campaigns";
import type { RoomAccess } from "../repository";

export async function writeAudit(
  env: Env,
  access: RoomAccess,
  action: string,
  targetType: string,
  targetId: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_events(id,workspace_id,campaign_id,actor_user_id,actor_campaign_member_id,action,target_type,target_id,outcome,occurred_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'success',?9)`,
  )
    .bind(
      crypto.randomUUID(),
      access.workspaceId,
      access.campaignId,
      access.userId,
      access.memberId,
      action,
      targetType,
      targetId,
      Date.now(),
    )
    .run();
}
export async function writeInviteAudit(
  env: Env,
  userId: string,
  slug: string,
): Promise<void> {
  const access = await requireCampaignAccess(env, userId, slug);
  await writeAudit(env, access, "invite.redeem", "campaign", access.campaignId);
}
