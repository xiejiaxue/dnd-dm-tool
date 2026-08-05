import { describe, it, expect } from 'vitest';
import { applyCampaignOp, isCampaignOp } from './campaign-ops';
import { createCampaign } from './campaign';
import { canOp } from './ops';
import { Op } from './types';

describe('isCampaignOp', () => {
  it('identifies campaign ops', () => {
    expect(isCampaignOp({ op: 'addEnemy', entryId: 'MM__Goblin', nameZh: '地精' })).toBe(true);
    expect(isCampaignOp({ op: 'removeEnemy', entryId: 'MM__Goblin' })).toBe(true);
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
});

describe('canOp campaign ops', () => {
  it('dm allowed, player denied', () => {
    const ops: Op[] = [
      { op: 'addEnemy', entryId: 'x', nameZh: 'y' },
      { op: 'removeEnemy', entryId: 'x' },
      { op: 'switchCampaign', campaignId: 'c1' },
    ];
    for (const op of ops) {
      expect(canOp('dm', op)).toBe(true);
      expect(canOp('player', op)).toBe(false);
    }
  });
});
