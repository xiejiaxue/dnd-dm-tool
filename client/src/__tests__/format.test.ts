import { describe, it, expect } from 'vitest';
import { renderMarkup, formatMonster, formatSpell } from '../format';

describe('renderMarkup', () => {
  it('strips 5etools inline tags to inner text', () => {
    expect(renderMarkup('受 {@damage 8d6} 点火焰伤害，{@hit +4} 命中，{@dc 13} 豁免。')).toBe('受 8d6 点火焰伤害，+4 命中，13 豁免。');
  });
  it('handles italic/bold tags', () => {
    expect(renderMarkup('{@i 灵巧逃脱}。')).toBe('灵巧逃脱。');
  });
  it('keeps plain text', () => {
    expect(renderMarkup('普通文本')).toBe('普通文本');
  });
  it('removes link pipe suffixes', () => {
    expect(renderMarkup('见 {@condition 中毒}。')).toBe('见 中毒。');
  });
});

describe('formatMonster', () => {
  it('builds a Chinese stat block from 5etools monster shape', () => {
    const m = {
      name: '鸟羽人',
      type: { type: 'humanoid', tags: ['鸟羽人'] },
      size: ['M'],
      alignment: ['N', 'G'],
      ac: [12],
      hp: { average: 13, formula: '3d8' },
      speed: { walk: 20, fly: 50 },
      str: 10, dex: 14, con: 10, int: 11, wis: 12, cha: 11,
      languages: ['气族语', '鸟羽人语'],
      cr: '1/4',
      trait: [
        { name: '俯冲攻击', entries: ['命中后额外造成 {@damage 1d6} 点伤害。'] },
      ],
      action: [
        { name: '禽爪', entries: ['命中{@hit +4}。'] },
      ],
    };
    const sb = formatMonster(m);
    expect(sb.name).toBe('鸟羽人');
    expect(sb.meta).toBe('中型，类人生物，中立善良，CR 1/4');
    expect(sb.rows).toEqual([
      ['AC', '12'],
      ['HP', '13（3d8）'],
      ['速度', '步行 20，飞行 50'],
      ['力量', '10'], ['敏捷', '14'], ['体质', '10'],
      ['智力', '11'], ['感知', '12'], ['魅力', '11'],
      ['语言', '气族语、鸟羽人语'],
    ]);
    expect(sb.body[0]).toBe('**俯冲攻击。** 命中后额外造成 1d6 点伤害。');
    expect(sb.body[1]).toBe('**禽爪。** 命中+4。');
  });

  it('handles object-form AC and unaligned monsters', () => {
    const m = { name: '傀儡', size: ['L'], type: { type: 'construct' }, alignment: ['U'], ac: [{ ac: 17, from: ['天生护甲'] }], cr: 5 };
    const sb = formatMonster(m);
    expect(sb.meta).toBe('大型，构装体，无阵营，CR 5');
    expect(sb.rows[0]).toEqual(['AC', '17']);
  });
});

describe('formatSpell', () => {
  it('builds a Chinese stat block from 5etools spell shape', () => {
    const s = {
      name: '火球术',
      level: 3,
      school: 'V',
      time: [{ number: 1, unit: 'action' }],
      range: { type: 'point', distance: { type: 'feet', amount: 150 } },
      components: { v: true, s: true, m: '一小球蝙蝠粪及硫磺' },
      duration: [{ type: 'instant' }],
      entries: ['目标点周围半径 20 尺内的每个生物必须进行一次敏捷豁免。', '并点燃所有可燃物件。'],
    };
    const sb = formatSpell(s);
    expect(sb.name).toBe('火球术');
    expect(sb.meta).toBe('3 环 塑能，1 动作');
    expect(sb.rows).toEqual([
      ['施法距离', '150 尺'],
      ['成分', 'V, S, M（一小球蝙蝠粪及硫磺）'],
      ['持续时间', '瞬间'],
    ]);
    expect(sb.body.length).toBe(2);
  });

  it('formats timed/concentration durations', () => {
    const s = {
      name: '祝福术',
      level: 1,
      school: 'A',
      time: [{ number: 1, unit: 'action' }],
      range: { type: 'self' },
      components: { v: true, s: true, m: '一小撮圣水' },
      duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }],
      entries: ['每个生物的攻击和豁免+{@dice 1d4}。'],
    };
    const sb = formatSpell(s);
    expect(sb.meta).toBe('1 环 防护，1 动作');
    expect(sb.rows).toEqual([
      ['施法距离', '自身'],
      ['成分', 'V, S, M（一小撮圣水）'],
      ['持续时间', '专注，1 分钟'],
    ]);
    expect(sb.body[0]).toBe('每个生物的攻击和豁免+1d4。');
  });
});
