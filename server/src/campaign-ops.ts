import { Campaign, Op } from './types';

export function isCampaignOp(op: Op): boolean {
  return op.op === 'addEnemy' || op.op === 'removeEnemy' || op.op === 'switchCampaign';
}

// Applies enemy-library ops to a Campaign. switchCampaign is handled by
// GameServer (it needs the store + current scene), so it's a no-op here.
export function applyCampaignOp(campaign: Campaign, op: Op): void {
  switch (op.op) {
    case 'addEnemy': {
      if (!campaign.enemies.some(e => e.entryId === op.entryId)) {
        campaign.enemies.push({ entryId: op.entryId, nameZh: op.nameZh });
      }
      return;
    }
    case 'removeEnemy': {
      campaign.enemies = campaign.enemies.filter(e => e.entryId !== op.entryId);
      return;
    }
    default:
      return;
  }
}
