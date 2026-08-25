import { describe, it, expect } from 'vitest';
import { applyCampaignOp, isCampaignOp } from './campaign-ops';
import { createCampaign } from './campaign';
import { canOp } from './ops';
import { Op } from './types';

describe('isCampaignOp', () => {
  it('identifies campaign ops', () => {
    expect(isCampaignOp({ op: 'addEnemy', entryId: 'MM__Goblin', nameZh: '地精' })).toBe(true);
    expect(isCampaignOp({ op: 'removeEnemy', entryId: 'MM__Goblin' })).toBe(true);
    expect(isCampaignOp({ op: 'removeNpc', npcId: 'npc-1' })).toBe(true);
    expect(isCampaignOp({ op: 'switchCampaign', campaignId: 'c1' })).toBe(true);
    expect(isCampaignOp({ op: 'moveToken', tokenId: 't1', x: 1, y: 1 })).toBe(false);
  });
});

describe('applyCampaignOp', () => {
  it('addEnemy dedupes by entryId and preserves order', () => {
    const c = createCampaign('t');
    applyCampaignOp(c, { op: 'addEnemy', entryId: 'MM__Goblin', nameZh: '地精' });
    applyCampaignOp(c, { op: 'addEnemy', entryId: 'MM__Goblin', nameZh: '地精' });
    applyCampaignOp(c, { op: 'addEnemy', entryId: 'MM__Hobgoblin', nameZh: '大地精' });
    expect(c.enemies.map(e => e.entryId)).toEqual(['MM__Goblin', 'MM__Hobgoblin']);
  });

  it('removeEnemy removes', () => {
    const c = createCampaign('t');
    applyCampaignOp(c, { op: 'addEnemy', entryId: 'MM__Goblin', nameZh: '地精' });
    applyCampaignOp(c, { op: 'removeEnemy', entryId: 'MM__Goblin' });
    expect(c.enemies).toEqual([]);
  });

  it('creates, updates, and removes campaign NPC records by id', () => {
    const c = createCampaign('t');
    const npc = {
      id: 'npc-1', name: '老乔', aliases: [], role: '老板', location: '旅店', status: 'active' as const,
      notesMarkdown: '知道一条密道。', sourceFile: 'npc.md', updatedAt: 1,
    };
    applyCampaignOp(c, { op: 'upsertNpc', npc });
    applyCampaignOp(c, { op: 'upsertNpc', npc: { ...npc, location: '码头', updatedAt: 2 } });
    expect(c.npcs).toEqual([expect.objectContaining({ id: 'npc-1', location: '码头' })]);
    applyCampaignOp(c, { op: 'removeNpc', npcId: 'npc-1' });
    expect(c.npcs).toEqual([]);
  });
});

describe('canOp campaign ops', () => {
  it('dm allowed, player denied', () => {
    const ops: Op[] = [
      { op: 'addEnemy', entryId: 'x', nameZh: 'y' },
      { op: 'removeEnemy', entryId: 'x' },
      { op: 'upsertNpc', npc: { id: 'npc', name: 'n', aliases: [], role: '', location: '', status: 'active', notesMarkdown: '', sourceFile: null, updatedAt: 1 } },
      { op: 'removeNpc', npcId: 'npc' },
      { op: 'switchCampaign', campaignId: 'c1' },
    ];
    for (const op of ops) {
      expect(canOp('dm', op)).toBe(true);
      expect(canOp('player', op)).toBe(false);
    }
  });
});
