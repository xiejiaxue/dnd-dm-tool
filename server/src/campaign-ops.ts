import { Campaign, Op } from './types';

export type CampaignOp = Extract<Op, { op: 'addEnemy' | 'removeEnemy' | 'upsertNpc' | 'removeNpc' | 'switchCampaign' }>;

export function isCampaignOp(op: Op): op is CampaignOp {
  return op.op === 'addEnemy' || op.op === 'removeEnemy' || op.op === 'upsertNpc' || op.op === 'removeNpc' || op.op === 'switchCampaign';
}

// Applies enemy-library ops to a Campaign. switchCampaign is handled by
// GameServer (it needs the store + current scene), so it's a no-op here.
export function applyCampaignOp(campaign: Campaign, op: CampaignOp): void {
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
    case 'upsertNpc': {
      const npcs = campaign.npcs ?? (campaign.npcs = []);
      const index = npcs.findIndex(npc => npc.id === op.npc.id);
      if (index >= 0) npcs[index] = structuredClone(op.npc);
      else npcs.push(structuredClone(op.npc));
      return;
    }
    case 'removeNpc': {
      campaign.npcs = (campaign.npcs ?? []).filter(npc => npc.id !== op.npcId);
      return;
    }
    case 'switchCampaign':
      return;
    default: {
      // Exhaustiveness guard: a future campaign op must not silently no-op.
      const _exhaustive: never = op;
      void _exhaustive;
      return;
    }
  }
}
