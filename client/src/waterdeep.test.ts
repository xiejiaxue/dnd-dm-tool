import { describe, it, expect } from 'vitest';
import { waterdeepIndex, waterdeepHp } from './waterdeep';
import { getWaterdeepCard, searchWaterdeep, waterdeepToken } from '../../shared/waterdeep';
import { formatMonster } from './format';

describe('Waterdeep NPC cards and tokens', () => {
  it('gives every indexed NPC a complete card, stable unique id, token and initial HP', () => {
    expect(new Set(waterdeepIndex.map(n => n.id)).size).toBe(waterdeepIndex.length);
    expect(waterdeepIndex.filter(n => n.combat).length).toBe(142);
    for (const n of waterdeepIndex) {
      const card = getWaterdeepCard(n.id)!;
      expect(card.name).toBe(n.nameZh);
      expect(card.campaignCard.rows.some(([key]) => key === '护甲等级')).toBe(true);
      expect(card.campaignCard.body.join('\n')).not.toMatch(/<details>|<summary>/);
      expect(waterdeepHp(n.id)).toEqual({ current: card.hp.average, max: card.hp.average });
      expect(card.hp.average).toBeGreaterThan(0);
      expect(waterdeepToken(n.id)).toContain('aria-label=');
      expect(formatMonster(card).name).toBe(n.nameZh);
    }
  });
  it('searches name, alias and faction without mixing entry types', () => {
    expect(searchWaterdeep('Xanathar').some(n => n.nameZh === '珊娜萨')).toBe(true);
    expect(searchWaterdeep('卡萨兰特').length).toBeGreaterThan(5);
    expect(searchWaterdeep('曼松', 'spell')).toEqual([]);
    expect(searchWaterdeep('')).toEqual([]);
    expect(getWaterdeepCard('MM__Goblin')).toBeUndefined();
    expect(waterdeepToken('unknown')).toBeUndefined();
    expect(waterdeepHp(null)).toBeUndefined();
  });
  it('retains boss rules and separates Manshoon from his simulacrum', () => {
    const card = (name: string) => getWaterdeepCard(waterdeepIndex.find(n => n.nameZh === name)!.id)!;
    expect(card('珊娜萨').campaignCard.body.join('\n')).toContain('巢穴动作');
    expect(card('珊娜萨').campaignCard.body.join('\n')).toContain('传奇动作');
    expect(card('贾拉索·班瑞').campaignCard.body.join('\n')).toContain('传奇');
    expect(card('维克托罗·卡萨兰特').hp.average).toBe(97);
    expect(card('曼松').hp.average).toBe(126);
    expect(card('洛瑟·米尔克拉夫').hp.average).toBe(31);
    expect(card('斯拉库斯').campaignCard.body.join('\n')).toContain('短休或长休后恢复');
    expect(card('曼松拟像').campaignCard.rows).toContainEqual(['护甲等级', '12']);
    expect(card('曼松拟像').campaignCard.body.join('\n')).not.toContain('9 环——');
  });
  it('uses doppelganger, not mimic, stats for the shapechanger NPCs', () => {
    for (const name of ['邦妮', '威利福特·克维洛']) {
      const npc = waterdeepIndex.find(n => n.nameZh === name)!;
      const card = getWaterdeepCard(npc.id)!;
      expect(npc).toMatchObject({ template: '变形怪', cr: '3', hp: 52 });
      expect(card.campaignCard.body.join('\n')).toContain('读心Read Thoughts');
      expect(card.campaignCard.body.join('\n')).not.toContain('拟身怪');
    }
  });
});
