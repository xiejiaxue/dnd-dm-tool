import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARACTER_RULE_SOURCES,
  emptyDnd5eCharacterSheet,
  deriveDnd5eCharacter,
  fallbackCharacterRuleCatalog,
  normalizeDnd5eCharacterSheet,
  personalCharacterActorSystemFromDerived,
  pointBuyCost,
  recalculateDnd5eCharacterSheet,
} from '../types';
import { abilityBonusChoiceSlots, gearOptionsForSheet, optionsForSheet, resolveGearOption, setRuleSource, splitFeatOptions } from '../plugins/dnd5e-character-sheet/model';

describe('D&D 5e character sheet plugin', () => {
  it('disables PHB 2024 and enables every other rule source for a new character by default', () => {
    const sheet = emptyDnd5eCharacterSheet();

    expect(sheet.rules.enabledSources).not.toContain('XPHB');
    expect(sheet.rules.enabledSources).toEqual(
      DEFAULT_CHARACTER_RULE_SOURCES.filter(source => source.id !== 'XPHB').map(source => source.id),
    );
  });

  it('keeps PHB enabled and removes selections from a disabled expansion', () => {
    const sheet = emptyDnd5eCharacterSheet('弥拉');
    sheet.rules.enabledSources = ['PHB', 'XGE'];
    sheet.feats = [
      { id: 'feat:XGE:Elven Accuracy', kind: 'feat', name: '精灵精准', nameEn: 'Elven Accuracy', source: 'XGE' },
      { id: 'feat:PHB:Alert', kind: 'feat', name: '警觉', nameEn: 'Alert', source: 'PHB' },
    ];

    const result = setRuleSource(sheet, 'XGE', false);

    expect(result.rules.enabledSources).toEqual(['PHB']);
    expect(result.feats.map(feat => feat.source)).toEqual(['PHB']);
    expect(setRuleSource(result, 'PHB', false)).toBe(result);
  });

  it('normalizes untrusted stored sheets and filters references outside enabled books', () => {
    const normalized = normalizeDnd5eCharacterSheet({
      rules: { enabledSources: ['PHB', 'TCE', '../bad'] },
      identity: { characterName: '  凯拉  ', avatarUrl: 'javascript:alert(1)' },
      advancement: {
        level: 200,
        race: { id: 'race:VGM:Aasimar', kind: 'race', name: '阿斯莫', nameEn: 'Aasimar', source: 'VGM' },
      },
      abilities: { str: -20, dex: 999 },
      combat: { hitPoints: { max: 0 } },
    });

    expect(normalized.identity).toMatchObject({ characterName: '凯拉', avatarUrl: '' });
    expect(normalized.rules.enabledSources).toEqual(['PHB', 'TCE']);
    expect(normalized.advancement).toMatchObject({ level: 20, race: null });
    expect(normalized.abilities).toMatchObject({ str: 1, dex: 30 });
    expect(normalized.combat.hitPoints.max).toBe(1);
  });

  it('filters catalog options through the character-owned rule selection', () => {
    const catalog = fallbackCharacterRuleCatalog();
    catalog.options.push({ id: 'race:VGM:Aasimar', kind: 'race', name: '阿斯莫', nameEn: 'Aasimar', source: 'VGM' });
    const sheet = emptyDnd5eCharacterSheet();
    sheet.rules.enabledSources = ['PHB'];
    expect(optionsForSheet(catalog, sheet, 'race').some(option => option.source === 'VGM')).toBe(false);
    expect(optionsForSheet(catalog, setRuleSource(sheet, 'VGM', true), 'race')).toContainEqual(
      expect.objectContaining({ nameEn: 'Aasimar', source: 'VGM' }),
    );
  });

  it('splits feats into selected and available groups honouring rule sources', () => {
    const catalog = fallbackCharacterRuleCatalog();
    catalog.options.push(
      { id: 'feat:PHB:Alert', kind: 'feat', name: '警觉', nameEn: 'Alert', source: 'PHB' },
      { id: 'feat:XGE:Elven Accuracy', kind: 'feat', name: '精灵精准', nameEn: 'Elven Accuracy', source: 'XGE' },
      { id: 'feat:TCE:Chef', kind: 'feat', name: '厨师', nameEn: 'Chef', source: 'TCE' },
    );
    const sheet = emptyDnd5eCharacterSheet('布鲁诺');
    sheet.rules.enabledSources = ['PHB', 'XGE'];
    sheet.feats = [
      { id: 'feat:XGE:Elven Accuracy', kind: 'feat', name: '精灵精准', nameEn: 'Elven Accuracy', source: 'XGE' },
      { id: 'feat:PHB:Alert', kind: 'feat', name: '警觉', nameEn: 'Alert', source: 'PHB' },
      { id: 'feat:PHB:Removed Feat', kind: 'feat', name: '失效引用', nameEn: 'Removed Feat', source: 'PHB' },
    ];

    const { selected, available } = splitFeatOptions(catalog, sheet);

    expect(selected.map(feat => feat.id)).toEqual(['feat:XGE:Elven Accuracy', 'feat:PHB:Alert']);
    expect(available).toEqual([]);

    const enabled = splitFeatOptions(catalog, setRuleSource(sheet, 'TCE', true));
    expect(enabled.available.map(feat => feat.id)).toEqual(['feat:TCE:Chef']);
  });

  it('filters gear slot options and resolves stale references', () => {
    const catalog = fallbackCharacterRuleCatalog();
    catalog.options.push(
      { id: 'item:PHB:Longsword', kind: 'item', name: '长剑', nameEn: 'Longsword', source: 'PHB', item: { category: 'M', weight: 3, armorBase: null, armorDexCap: null, armorBonus: 0, damage: '1d8', damageType: 'S', range: '', description: '' } },
      { id: 'item:PHB:Shield', kind: 'item', name: '盾牌', nameEn: 'Shield', source: 'PHB', item: { category: 'S', weight: 6, armorBase: 2, armorDexCap: null, armorBonus: 0, damage: '', damageType: '', range: '', description: '' } },
      { id: 'item:PHB:Leather Armor', kind: 'item', name: '皮甲', nameEn: 'Leather Armor', source: 'PHB', item: { category: 'LA', weight: 10, armorBase: 11, armorDexCap: null, armorBonus: 0, damage: '', damageType: '', range: '', description: '' } },
      { id: 'item:TCE:Chef', kind: 'item', name: '厨师用具', nameEn: 'Chef', source: 'TCE', item: { category: 'T', weight: 1, armorBase: null, armorDexCap: null, armorBonus: 0, damage: '', damageType: '', range: '', description: '' } },
    );
    const sheet = emptyDnd5eCharacterSheet();
    sheet.rules.enabledSources = ['PHB'];

    const slots = gearOptionsForSheet(catalog, sheet);
    expect(slots.armorOptions.map(option => option.nameEn)).toEqual(['Leather Armor']);
    expect(slots.weaponOptions.map(option => option.nameEn)).toEqual(['Longsword']);
    expect(slots.offHandOptions.map(option => option.nameEn)).toEqual(['Longsword', 'Shield']);
    expect(resolveGearOption(catalog, sheet.gear.armor)).toBeNull();
    expect(resolveGearOption(catalog, { id: 'item:PHB:Longsword', kind: 'item', name: '长剑', nameEn: 'Longsword', source: 'PHB' })?.nameEn).toBe('Longsword');
  });

  it('uses the official 27-point cost curve and applies racial bonuses after point buy', () => {
    const catalog = fallbackCharacterRuleCatalog();
    const sheet = emptyDnd5eCharacterSheet('布鲁诺');
    sheet.advancement.race = { id: 'race:PHB:Dwarf', kind: 'race', name: '矮人', nameEn: 'Dwarf', source: 'PHB' };
    sheet.abilityGeneration.base = { str: 15, dex: 10, con: 14, int: 8, wis: 13, cha: 12 };

    const derived = deriveDnd5eCharacter(sheet, catalog);

    expect(pointBuyCost(15)).toBe(9);
    expect(derived.pointBuySpent).toBe(27);
    expect(derived.pointBuyValid).toBe(true);
    expect(derived.abilities).toMatchObject({ str: 15, con: 16 });
  });

  it('offers lineage races flexible +2/+1 bonuses and applies them once chosen', () => {
    const catalog = fallbackCharacterRuleCatalog();
    catalog.options.push({
      id: 'race:MPMM:Shadar-Kai', kind: 'race', name: '影灵', nameEn: 'Shadar-Kai', source: 'MPMM',
      speed: 30, abilityBonusChoices: [{ amounts: [2, 1], from: ['str', 'dex', 'con', 'int', 'wis', 'cha'], distinct: true }],
    });
    const sheet = emptyDnd5eCharacterSheet('影之刃');
    sheet.advancement.race = { id: 'race:MPMM:Shadar-Kai', kind: 'race', name: '影灵', nameEn: 'Shadar-Kai', source: 'MPMM' };
    sheet.abilityGeneration.base = { str: 8, dex: 15, con: 13, int: 10, wis: 12, cha: 10 };

    const pending = deriveDnd5eCharacter(sheet, catalog);
    expect(pending.racialBonuses).toMatchObject({ dex: 0, cha: 0 });
    expect(abilityBonusChoiceSlots(catalog, sheet)).toEqual([
      { amount: 2, from: ['str', 'dex', 'con', 'int', 'wis', 'cha'], label: '影灵' },
      { amount: 1, from: ['str', 'dex', 'con', 'int', 'wis', 'cha'], label: '影灵' },
    ]);

    sheet.abilityGeneration.bonusChoices = ['dex', 'cha'];
    const applied = deriveDnd5eCharacter(sheet, catalog);
    expect(applied.racialBonuses).toMatchObject({ dex: 2, cha: 1, str: 0 });
    expect(applied.abilities).toMatchObject({ dex: 17, cha: 11 });
  });

  it('automatically derives proficiency, saves, skills, hit points and spellcasting values', () => {
    const catalog = fallbackCharacterRuleCatalog();
    const wizard = catalog.options.find(option => option.id === 'class:PHB:Wizard')!;
    wizard.skillChoices = [{ count: 2, from: ['arcana', 'investigation'] }];
    const sheet = emptyDnd5eCharacterSheet('伊莉亚');
    sheet.advancement.level = 5;
    sheet.advancement.class = { id: wizard.id, kind: 'class', name: wizard.name, nameEn: wizard.nameEn, source: wizard.source };
    sheet.abilityGeneration.base = { str: 8, dex: 14, con: 14, int: 15, wis: 12, cha: 8 };
    sheet.training.skills = ['arcana'];

    const derived = deriveDnd5eCharacter(sheet, catalog);

    expect(derived.proficiencyBonus).toBe(3);
    expect(derived.savingThrowProficiencies).toEqual(['int', 'wis']);
    expect(derived.skills.find(skill => skill.id === 'arcana')?.modifier).toBe(5);
    expect(derived.hitPointsMaximum).toBe(32);
    expect(derived.spellcasting).toMatchObject({ ability: 'int', saveDc: 13, attackBonus: 5 });
    expect(derived.spellcasting.slots.map(slot => slot.maximum)).toEqual([4, 3, 2]);
  });

  it('migrates old sheets without losing their final ability scores', () => {
    const migrated = normalizeDnd5eCharacterSheet({
      schemaVersion: 1,
      identity: { characterName: '旧角色' },
      abilities: { str: 17, dex: 12, con: 14, int: 9, wis: 11, cha: 8 },
    });

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.abilities.str).toBe(17);
    expect(migrated.abilityGeneration.base.str).toBe(15);
    expect(migrated.abilityGeneration.customBonuses.str).toBe(2);
    expect(recalculateDnd5eCharacterSheet(migrated, fallbackCharacterRuleCatalog()).abilities.str).toBe(17);
  });

  it('keeps pact-magic slots at their actual slot level', () => {
    const catalog = fallbackCharacterRuleCatalog();
    catalog.options.push({
      id: 'class:PHB:Warlock', kind: 'class', name: '邪术师', nameEn: 'Warlock', source: 'PHB',
      hitDie: 8, spellcastingAbility: 'cha', features: [],
    });
    const sheet = emptyDnd5eCharacterSheet('伊莱亚斯');
    sheet.advancement.level = 5;
    sheet.advancement.class = { id: 'class:PHB:Warlock', kind: 'class', name: '邪术师', nameEn: 'Warlock', source: 'PHB' };

    expect(deriveDnd5eCharacter(sheet, catalog).spellcasting.slots).toEqual([
      { level: 3, maximum: 2, used: 0, remaining: 2 },
    ]);
  });

  it('imports automatically derived features and resources into the room actor snapshot', () => {
    const catalog = fallbackCharacterRuleCatalog();
    const fighter = catalog.options.find(option => option.id === 'class:PHB:Fighter')!;
    fighter.features = [{ id: 'feature:second-wind', name: '回气', source: 'PHB', level: 1, description: '恢复生命值。' }];
    const sheet = emptyDnd5eCharacterSheet('布鲁诺');
    sheet.advancement.class = { id: fighter.id, kind: 'class', name: fighter.name, nameEn: fighter.nameEn, source: fighter.source };
    const derived = deriveDnd5eCharacter(sheet, catalog);
    const actor = personalCharacterActorSystemFromDerived({
      id: 'character-1', ownerUserId: 'user-1', name: '布鲁诺', color: '#b45309', sheet,
      status: 'active', createdAt: 1, updatedAt: 1,
    }, derived);

    expect(actor.items).toContainEqual(expect.objectContaining({ name: '回气', itemType: 'feat', description: '恢复生命值。' }));
    expect(actor.resources).toContainEqual(expect.objectContaining({ id: 'hit-dice', max: 1 }));
  });

  it('normalizes gear slots and keeps legacy sheets working', () => {
    const migrated = normalizeDnd5eCharacterSheet({
      schemaVersion: 1,
      identity: { characterName: '旧角色' },
      abilities: { str: 15, dex: 12, con: 14, int: 9, wis: 11, cha: 8 },
    });
    expect(migrated.gear).toEqual({ armor: null, mainHand: null, offHand: null });

    const sheet = normalizeDnd5eCharacterSheet({
      rules: { enabledSources: ['PHB'] },
      gear: {
        armor: { id: 'item:PHB:Leather Armor', kind: 'item', name: '皮甲', nameEn: 'Leather Armor', source: 'PHB' },
        mainHand: { reference: { id: 'item:PHB:Longsword', kind: 'item', name: '长剑', nameEn: 'Longsword', source: 'PHB' }, hitAdjust: 99, damageAdjust: -3 },
        offHand: { reference: { id: 'item:TCE:Chef', kind: 'item', name: '厨师', nameEn: 'Chef', source: 'TCE' }, hitAdjust: 0, damageAdjust: 0 },
      },
    });
    expect(sheet.gear.armor).toMatchObject({ nameEn: 'Leather Armor' });
    expect(sheet.gear.mainHand).toMatchObject({ hitAdjust: 20, damageAdjust: -3 });
    expect(sheet.gear.offHand).toBeNull();
  });

  it('derives armor class from gear slots with stacking shield bonus', () => {
    const catalog = fallbackCharacterRuleCatalog();
    catalog.options.push(
      { id: 'item:PHB:Leather Armor', kind: 'item', name: '皮甲', nameEn: 'Leather Armor', source: 'PHB', item: { category: 'LA', weight: 10, armorBase: 11, armorDexCap: null, armorBonus: 0, damage: '', damageType: '', range: '', description: '' } },
      { id: 'item:PHB:Shield', kind: 'item', name: '盾牌', nameEn: 'Shield', source: 'PHB', item: { category: 'S', weight: 6, armorBase: 2, armorDexCap: null, armorBonus: 0, damage: '', damageType: '', range: '', description: '' } },
      { id: 'item:TCE:Repulsion Shield', kind: 'item', name: '斥力之盾', nameEn: 'Repulsion Shield', source: 'TCE', item: { category: 'S', weight: 6, armorBase: 2, armorDexCap: null, armorBonus: 1, damage: '', damageType: '', range: '', description: '' } },
    );
    const sheet = emptyDnd5eCharacterSheet('盾卫');
    sheet.abilityGeneration.base = { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 };

    expect(deriveDnd5eCharacter(sheet, catalog).armorClass).toBe(12);

    sheet.gear.armor = { id: 'item:PHB:Leather Armor', kind: 'item', name: '皮甲', nameEn: 'Leather Armor', source: 'PHB' };
    expect(deriveDnd5eCharacter(sheet, catalog).armorClass).toBe(13);

    sheet.gear.offHand = { reference: { id: 'item:TCE:Repulsion Shield', kind: 'item', name: '斥力之盾', nameEn: 'Repulsion Shield', source: 'TCE' }, hitAdjust: 0, damageAdjust: 0 };
    expect(deriveDnd5eCharacter(sheet, catalog).armorClass).toBe(16);

    sheet.combat.armorClassOverride = 18;
    expect(deriveDnd5eCharacter(sheet, catalog).armorClass).toBe(18);
  });

  it('derives weapon attacks with ability choice, offhand and versatile rules', () => {
    const catalog = fallbackCharacterRuleCatalog();
    catalog.options.push(
      { id: 'item:PHB:Longsword', kind: 'item', name: '长剑', nameEn: 'Longsword', source: 'PHB', item: { category: 'M', weight: 3, armorBase: null, armorDexCap: null, armorBonus: 0, damage: '1d8', damageType: 'S', damageVersatile: '1d10', weaponCategory: '军用', range: '', description: '' } },
      { id: 'item:PHB:Dagger', kind: 'item', name: '匕首', nameEn: 'Dagger', source: 'PHB', item: { category: 'M', weight: 2, armorBase: null, armorDexCap: null, armorBonus: 0, damage: '1d4', damageType: 'P', finesse: true, light: true, thrown: true, weaponCategory: '简易', range: '20/60', description: '' } },
      { id: 'item:PHB:Shortbow', kind: 'item', name: '短弓', nameEn: 'Shortbow', source: 'PHB', item: { category: 'R', weight: 2, armorBase: null, armorDexCap: null, armorBonus: 0, damage: '1d6', damageType: 'P', ammunition: true, twoHanded: true, weaponCategory: '简易', range: '80/320', description: '' } },
      { id: 'item:TCE:Moon Sickle', kind: 'item', name: '+1 月镰', nameEn: '+1 Moon Sickle', source: 'TCE', item: { category: 'M', weight: 2, armorBase: null, armorDexCap: null, armorBonus: 0, damage: '1d4', damageType: 'S', finesse: true, light: true, weaponCategory: 'simple', bonusWeapon: 1, range: '', description: '' } },
    );
    const fighter = catalog.options.find(option => option.id === 'class:PHB:Fighter')!;
    fighter.weaponProficiencies = ['简易', '军用'];
    const sheet = emptyDnd5eCharacterSheet('战士');
    sheet.advancement.class = { id: fighter.id, kind: 'class', name: fighter.name, nameEn: fighter.nameEn, source: fighter.source };
    sheet.abilityGeneration.base = { str: 15, dex: 14, con: 10, int: 8, wis: 12, cha: 10 };
    const reference = (id: string) => catalog.options.find(option => option.id === id)!.name;

    sheet.gear.mainHand = { reference: { id: 'item:PHB:Longsword', kind: 'item', name: reference('item:PHB:Longsword'), nameEn: 'Longsword', source: 'PHB' }, hitAdjust: 0, damageAdjust: 0 };
    let attacks = deriveDnd5eCharacter(sheet, catalog).attacks;
    expect(attacks).toHaveLength(1);
    // 副手为空槽 → 两用武器用两用骰（设计文档：副手空且带 damageVersatile 时用两用骰）
    expect(attacks[0]).toMatchObject({ slot: 'mainHand', abilityUsed: 'str', proficient: true, attackBonus: 4, damage: '1d10', damageBonus: 2, damageType: 'S' });

    sheet.gear.offHand = { reference: { id: 'item:PHB:Dagger', kind: 'item', name: reference('item:PHB:Dagger'), nameEn: 'Dagger', source: 'PHB' }, hitAdjust: 0, damageAdjust: 0 };
    attacks = deriveDnd5eCharacter(sheet, catalog).attacks;
    expect(attacks[0].damage).toBe('1d8');
    expect(attacks[0].abilityUsed).toBe('str');
    expect(attacks[1]).toMatchObject({ slot: 'offHand', abilityUsed: 'str', proficient: true, attackBonus: 4, damage: '1d4', damageBonus: 0 });
    expect(attacks[1].notes).toContain('轻武器');

    sheet.gear.offHand = null;
    attacks = deriveDnd5eCharacter(sheet, catalog).attacks;
    expect(attacks[0].damage).toBe('1d10');

    sheet.gear.mainHand = { reference: { id: 'item:PHB:Shortbow', kind: 'item', name: reference('item:PHB:Shortbow'), nameEn: 'Shortbow', source: 'PHB' }, hitAdjust: 0, damageAdjust: 0 };
    attacks = deriveDnd5eCharacter(sheet, catalog).attacks;
    expect(attacks[0]).toMatchObject({ abilityUsed: 'dex', attackBonus: 4, damageBonus: 2, proficient: true });

    sheet.gear.mainHand = { reference: { id: 'item:TCE:Moon Sickle', kind: 'item', name: reference('item:TCE:Moon Sickle'), nameEn: '+1 Moon Sickle', source: 'TCE' }, hitAdjust: 1, damageAdjust: 2 };
    attacks = deriveDnd5eCharacter(sheet, catalog).attacks;
    // 灵巧取力敏较高者，力敏同为 +2 时按实现取 str（与上方匕首副手断言一致）
    expect(attacks[0]).toMatchObject({ abilityUsed: 'str', proficient: false, attackBonus: 2 + 2 + 1 + 1, damageBonus: 2 + 1 + 2 });
  });

  it('labels weapon proficiency from cleaned class proficiencies', () => {
    const catalog = fallbackCharacterRuleCatalog();
    catalog.options.push(
      { id: 'item:PHB:Quarterstaff', kind: 'item', name: '长棍', nameEn: 'Quarterstaff', source: 'PHB', item: { category: 'M', weight: 4, armorBase: null, armorDexCap: null, armorBonus: 0, damage: '1d6', damageType: 'B', weaponCategory: '军用', range: '', description: '' } },
    );
    const wizard = catalog.options.find(option => option.id === 'class:PHB:Wizard')!;
    wizard.weaponProficiencies = ['{@item 匕首', '{@item 长棍', '{@item 轻弩'];
    const sheet = emptyDnd5eCharacterSheet('法师');
    sheet.advancement.class = { id: wizard.id, kind: 'class', name: wizard.name, nameEn: wizard.nameEn, source: wizard.source };
    sheet.gear.mainHand = { reference: { id: 'item:PHB:Quarterstaff', kind: 'item', name: '长棍', nameEn: 'Quarterstaff', source: 'PHB' }, hitAdjust: 0, damageAdjust: 0 };

    const [attack] = deriveDnd5eCharacter(sheet, catalog).attacks;
    expect(attack.proficient).toBe(true);
  });
});
