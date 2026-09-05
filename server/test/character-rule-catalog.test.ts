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
  });
});
