import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCharacterRuleCatalog } from '../../scripts/build-character-rules.mjs';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('character rule catalog builder', () => {
  it('builds localized automation metadata and excludes sources outside the selected ruleset', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'dnd-character-rules-'));
    directories.push(directory);
    mkdirSync(path.join(directory, 'class'));
    mkdirSync(path.join(directory, 'generated'));
    writeFileSync(path.join(directory, 'races.json'), JSON.stringify({
      race: [
        { name: '精灵', ENG_name: 'Elf', source: 'PHB', speed: 30, ability: [{ dex: 2 }] },
        { name: '幻身灵', ENG_name: 'Changeling', source: 'ERLW', speed: 30, ability: [{ cha: 2 }, { choose: { from: ['dex', 'int'], count: 1, amount: 1 } }] },
        { name: '影灵', ENG_name: 'Shadar-Kai', source: 'MPMM', lineage: 'VRGR', speed: 30 },
        { name: '人类', ENG_name: 'Human', source: 'XPHB', speed: 30 },
        { name: '自制种族', ENG_name: 'Homebrew Race', source: 'HB' },
      ],
    }));
    writeFileSync(path.join(directory, 'items-base.json'), JSON.stringify({
      baseitem: [
        { name: '长剑', ENG_name: 'Longsword', source: 'PHB', type: 'M', weaponCategory: 'martial', dmg1: '1d8', dmg2: '1d10', dmgType: 'S', property: ['V'], weight: 3 },
        { name: '匕首', ENG_name: 'Dagger', source: 'PHB', type: 'M', weaponCategory: 'simple', dmg1: '1d4', dmgType: 'P', property: ['F', 'L', 'T'], weight: 2 },
        { name: '盾牌', ENG_name: 'Shield', source: 'PHB', type: 'S', ac: 2, weight: 6 },
      ],
    }));
    writeFileSync(path.join(directory, 'class', 'class-wizard.json'), JSON.stringify({
      class: [{ name: '法师', ENG_name: 'Wizard', source: 'PHB' }],
      subclass: [{ name: '预言学派', ENG_name: 'School of Divination', source: 'PHB', className: '法师' }],
    }));
    writeFileSync(path.join(directory, 'spells.json'), JSON.stringify({
      spell: [{
        name: '魔法飞弹', ENG_name: 'Magic Missile', source: 'PHB', level: 1,
        classes: { fromClassList: [{ name: 'Wizard', source: 'PHB' }] },
        entries: ['该正文不应进入角色选项索引。'],
      }],
    }));
    writeFileSync(path.join(directory, 'generated', 'gendata-spell-source-lookup.json'), JSON.stringify({
      phb: { 魔法飞弹: { class: { PHB: { Wizard: true } } } },
    }));
    const output = path.join(directory, 'character-options.json');

    const catalog = buildCharacterRuleCatalog(directory, output);
    const stored = JSON.parse(readFileSync(output, 'utf8')) as typeof catalog;

    expect(stored.options).toContainEqual(expect.objectContaining({
      id: 'spell:PHB:Magic Missile', kind: 'spell', name: '魔法飞弹', level: 1, classNames: ['Wizard'],
    }));
    expect(stored.options).toContainEqual(expect.objectContaining({
      kind: 'subclass', name: '预言学派', parentName: '法师',
    }));
    expect(stored.options.some(option => option.source === 'HB')).toBe(false);
    expect(stored.sources.map(source => source.id)).toEqual(expect.arrayContaining(['MPMM', 'ERLW', 'EFA']));
    expect(stored.options).toContainEqual(expect.objectContaining({
      kind: 'race', source: 'ERLW', name: '幻身灵', abilityBonuses: { cha: 2 },
    }));
    expect(stored.options).toContainEqual(expect.objectContaining({
      kind: 'race', name: '精灵', abilityBonuses: { dex: 2 },
    }));
    expect(stored.options).toContainEqual(expect.objectContaining({
      kind: 'race', source: 'MPMM', name: '影灵',
      abilityBonusChoices: [{ amounts: [2, 1], from: ['str', 'dex', 'con', 'int', 'wis', 'cha'], distinct: true }],
    }));
    expect(stored.options.find(option => option.kind === 'race' && option.source === 'XPHB')).not.toHaveProperty('abilityBonusChoices');
    expect(stored.options.find(option => option.kind === 'spell')?.spell?.description).toContain('该正文不应进入角色选项索引');
    expect(stored.options).toContainEqual(expect.objectContaining({
      kind: 'item', nameEn: 'Longsword',
      item: expect.objectContaining({ category: 'M', damage: '1d8', damageVersatile: '1d10', weaponCategory: '军用' }),
    }));
    const longswordItem = stored.options.find(option => option.kind === 'item' && option.nameEn === 'Longsword')?.item;
    expect(longswordItem).not.toHaveProperty('finesse');
    expect(longswordItem).not.toHaveProperty('twoHanded');
    expect(stored.options).toContainEqual(expect.objectContaining({
      kind: 'item', nameEn: 'Dagger',
      item: expect.objectContaining({ damage: '1d4', weaponCategory: '简易', finesse: true, light: true, thrown: true }),
    }));
    expect(stored.options).toContainEqual(expect.objectContaining({
      kind: 'item', nameEn: 'Shield',
      item: expect.objectContaining({ category: 'S', armorBase: 2 }),
    }));
  });
});
