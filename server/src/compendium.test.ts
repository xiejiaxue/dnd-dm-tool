import { describe, expect, it } from 'vitest';
import { monsterHasToken, monsterHitPoints, monsterInitiativeModifier } from '../../shared/compendium';

describe('monster compendium metadata', () => {
  it('uses the dexterity modifier for 2014 monsters', () => {
    expect(monsterInitiativeModifier({ dex: 14, cr: '1/4' })).toBe(2);
  });

  it('includes the 2024 initiative proficiency multiplier', () => {
    expect(monsterInitiativeModifier({ dex: 19, cr: '5', initiative: { proficiency: 1 } })).toBe(7);
    expect(monsterInitiativeModifier({ dex: 9, cr: '21', initiative: { proficiency: 2 } })).toBe(13);
  });

  it('extracts hit points and portrait availability defensively', () => {
    expect(monsterHitPoints({ hp: { average: 7, formula: '2d6' } })).toBe(7);
    expect(monsterHasToken({ hasToken: true })).toBe(true);
    expect(monsterHasToken({})).toBe(false);
  });
});
