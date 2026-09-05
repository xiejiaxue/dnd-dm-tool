import type { AbilityKey } from '../../tabletop-tools';
import {
  DEFAULT_CHARACTER_RULE_SOURCES,
  DND5E_CHARACTER_RULE_CATALOG_SCHEMA_VERSION,
  DND5E_CHARACTER_SHEET_SCHEMA_VERSION,
  emptyDnd5eCharacterSheet,
  type CharacterAbilityBonusChoice,
  type CharacterInventoryEntry,
  type CharacterItemProfile,
  type CharacterProficiencyChoice,
  type CharacterRuleCatalog,
  type CharacterRuleFeature,
  type CharacterRuleOption,
  type CharacterRuleOptionKind,
  type CharacterRuleReference,
  type CharacterRuleSource,
  type CharacterSpellProfile,
  type CharacterWeaponSlot,
  type Dnd5eCharacterSheet,
} from './types';

const ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const OPTION_KINDS: CharacterRuleOptionKind[] = ['race', 'class', 'subclass', 'background', 'feat', 'spell', 'item'];
const SOURCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/u;

export function normalizeDnd5eCharacterSheet(value: unknown, fallbackName = ''): Dnd5eCharacterSheet {
  const fallback = emptyDnd5eCharacterSheet(fallbackName);
  if (!isRecord(value)) return fallback;
  const identity = record(value.identity);
  const advancement = record(value.advancement);
  const rawAbilities = record(value.abilities);
  const abilityGeneration = record(value.abilityGeneration);
  const abilityBase = record(abilityGeneration.base);
  const customBonuses = record(abilityGeneration.customBonuses);
  const combat = record(value.combat);
  const hitPoints = record(combat.hitPoints);
  const training = record(value.training);
  const play = record(value.play);
  const deathSaves = record(play.deathSaves);
  const currency = record(value.currency);
  const roleplay = record(value.roleplay);
  const enabledSources = sourceList(record(value.rules).enabledSources, fallback.rules.enabledSources);
  const legacy = value.schemaVersion !== DND5E_CHARACTER_SHEET_SCHEMA_VERSION;
  const base = Object.fromEntries(ABILITIES.map(key => {
    const previous = integer(rawAbilities[key], 10, 1, 30);
    return [key, integer(abilityBase[key], legacy ? clamp(previous, 8, 15) : 10, 8, 15)];
  })) as Record<AbilityKey, number>;
  const custom = Object.fromEntries(ABILITIES.map(key => {
    const previous = integer(rawAbilities[key], 10, 1, 30);
    const migrated = legacy ? previous - base[key] : 0;
    return [key, integer(customBonuses[key], migrated, -10, 20)];
  })) as Record<AbilityKey, number>;
  const abilities = Object.fromEntries(ABILITIES.map(key => [key, integer(rawAbilities[key], base[key] + custom[key], 1, 30)])) as Record<AbilityKey, number>;
  const maximum = integer(hitPoints.max, 1, 1, 100_000);

  return {
    schemaVersion: DND5E_CHARACTER_SHEET_SCHEMA_VERSION,
    rules: { coreSource: 'PHB', enabledSources },
    identity: {
      characterName: text(identity.characterName, fallbackName, 120),
      playerName: text(identity.playerName, '', 120),
      pronouns: text(identity.pronouns, '', 80),
      alignment: text(identity.alignment, '', 80),
      avatarUrl: safeAvatarUrl(identity.avatarUrl),
      age: text(identity.age, '', 80),
      size: text(identity.size, '', 40),
      faith: text(identity.faith, '', 160),
    },
    advancement: {
      level: integer(advancement.level, 1, 1, 20),
      experience: integer(advancement.experience, 0, 0, 99_999_999),
      race: safeRuleReference(advancement.race, 'race', enabledSources),
      class: safeRuleReference(advancement.class, 'class', enabledSources),
      subclass: safeRuleReference(advancement.subclass, 'subclass', enabledSources),
      background: safeRuleReference(advancement.background, 'background', enabledSources),
    },
    abilityGeneration: {
      method: 'pointBuy',
      base,
      useRuleBonuses: legacy ? false : abilityGeneration.useRuleBonuses !== false,
      bonusChoices: abilityList(abilityGeneration.bonusChoices, 20),
      customBonuses: custom,
    },
    abilities,
    combat: {
      armorClass: integer(combat.armorClass, 10, 0, 50),
      armorClassOverride: combat.armorClassOverride === undefined && legacy && typeof combat.armorClass === 'number'
        ? integer(combat.armorClass, 10, 0, 50)
        : nullableInteger(combat.armorClassOverride, 0, 50),
      speed: integer(combat.speed, 30, 0, 500),
      speedOverride: combat.speedOverride === undefined && legacy && typeof combat.speed === 'number'
        ? integer(combat.speed, 30, 0, 500)
        : nullableInteger(combat.speedOverride, 0, 500),
      hitPoints: {
        current: integer(hitPoints.current, Math.min(1, maximum), 0, 100_000),
        max: maximum,
        maximumOverride: hitPoints.maximumOverride === undefined && legacy && typeof hitPoints.max === 'number'
          ? integer(hitPoints.max, 1, 1, 100_000)
          : nullableInteger(hitPoints.maximumOverride, 1, 100_000),
        temporary: integer(hitPoints.temporary, 0, 0, 100_000),
      },
    },
    training: {
      skills: stringList(training.skills, 100, 80),
      expertise: stringList(training.expertise, 100, 80),
      armor: stringList(training.armor, 100, 120),
      weapons: stringList(training.weapons, 100, 120),
      tools: stringList(training.tools, 100, 120),
      languages: stringList(training.languages, 100, 120),
    },
    feats: referenceList(value.feats, 'feat', enabledSources, 100),
    spells: referenceList(value.spells, 'spell', enabledSources, 500),
    inventory: inventoryList(value.inventory, enabledSources),
    gear: gearSection(value.gear, enabledSources),
    currency: {
      cp: integer(currency.cp, 0, 0, 100_000_000),
      sp: integer(currency.sp, 0, 0, 100_000_000),
      ep: integer(currency.ep, 0, 0, 100_000_000),
      gp: integer(currency.gp, 0, 0, 100_000_000),
      pp: integer(currency.pp, 0, 0, 100_000_000),
    },
    play: {
      inspiration: play.inspiration === true,
      deathSaves: {
        successes: integer(deathSaves.successes, 0, 0, 3),
        failures: integer(deathSaves.failures, 0, 0, 3),
      },
      hitDiceSpent: integer(play.hitDiceSpent, 0, 0, 20),
      spellSlotsUsed: numberRecord(play.spellSlotsUsed, 1, 9, 20),
      featureUses: numberRecord(play.featureUses, 0, 10_000, 200),
      conditions: stringList(play.conditions, 100, 120),
    },
    roleplay: {
      personalityTraits: text(roleplay.personalityTraits, '', 4000),
      ideals: text(roleplay.ideals, '', 4000),
      bonds: text(roleplay.bonds, '', 4000),
      flaws: text(roleplay.flaws, '', 4000),
      faith: text(roleplay.faith, '', 1000),
      organizations: text(roleplay.organizations, '', 4000),
    },
    customFeatures: featureList(value.customFeatures, 'CUSTOM', 100),
    biography: text(value.biography, '', 16_000),
    notes: text(value.notes, '', 16_000),
  };
}

export function normalizeCharacterRuleCatalog(value: unknown): CharacterRuleCatalog {
  if (!isRecord(value) || value.schemaVersion !== DND5E_CHARACTER_RULE_CATALOG_SCHEMA_VERSION) return fallbackCharacterRuleCatalog();
  const rawSources = Array.isArray(value.sources) ? value.sources : [];
  const rawOptions = Array.isArray(value.options) ? value.options : [];
  const sources = rawSources.slice(0, 100).flatMap(item => {
    try { return [ruleSource(item)]; } catch { return []; }
  });
  const sourceIds = new Set(sources.map(source => source.id));
  if (!sourceIds.has('PHB')) sources.unshift({ ...DEFAULT_CHARACTER_RULE_SOURCES[0] });
  const options = rawOptions.slice(0, 15_000).flatMap(item => {
    try {
      const option = ruleOption(item);
      return sourceIds.has(option.source) || option.source === 'PHB' ? [option] : [];
    } catch { return []; }
  });
  return {
    schemaVersion: DND5E_CHARACTER_RULE_CATALOG_SCHEMA_VERSION,
    generatedAt: finiteNumber(value.generatedAt, 0),
    sourceName: text(value.sourceName, 'DND5E 不全书 / 5etools-cn', 200),
    sourceUrl: httpUrl(value.sourceUrl, 'https://5echm.kagangtuya.top/'),
    sources: uniqueBy(sources, item => item.id),
    options: uniqueBy(options, item => item.id),
  };
}

export function fallbackCharacterRuleCatalog(): CharacterRuleCatalog {
  const classes: Array<[string, string, number, AbilityKey | null, AbilityKey[]]> = [
    ['Barbarian', '野蛮人', 12, null, ['str', 'con']], ['Bard', '吟游诗人', 8, 'cha', ['dex', 'cha']],
    ['Cleric', '牧师', 8, 'wis', ['wis', 'cha']], ['Druid', '德鲁伊', 8, 'wis', ['int', 'wis']],
    ['Fighter', '战士', 10, null, ['str', 'con']], ['Monk', '武僧', 8, 'wis', ['str', 'dex']],
    ['Paladin', '圣武士', 10, 'cha', ['wis', 'cha']], ['Ranger', '游侠', 10, 'wis', ['str', 'dex']],
    ['Rogue', '游荡者', 8, null, ['dex', 'int']], ['Sorcerer', '术士', 6, 'cha', ['con', 'cha']],
    ['Warlock', '魔契师', 8, 'cha', ['wis', 'cha']], ['Wizard', '法师', 6, 'int', ['int', 'wis']],
  ];
  const races: Array<[string, string, Partial<Record<AbilityKey, number>>]> = [
    ['Dwarf', '矮人', { con: 2 }], ['Elf', '精灵', { dex: 2 }], ['Halfling', '半身人', { dex: 2 }],
    ['Human', '人类', { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }],
    ['Dragonborn', '龙裔', { str: 2, cha: 1 }], ['Gnome', '侏儒', { int: 2 }],
    ['Half-Elf', '半精灵', { cha: 2 }], ['Half-Orc', '半兽人', { str: 2, con: 1 }], ['Tiefling', '提夫林', { int: 1, cha: 2 }],
  ];
  const backgrounds = [
    ['Acolyte', '侍僧'], ['Charlatan', '骗子'], ['Criminal', '罪犯'], ['Entertainer', '艺人'],
    ['Folk Hero', '平民英雄'], ['Guild Artisan', '公会工匠'], ['Hermit', '隐士'], ['Noble', '贵族'],
    ['Outlander', '化外之民'], ['Sage', '智者'], ['Sailor', '水手'], ['Soldier', '士兵'], ['Urchin', '流浪儿'],
  ];
  const options: CharacterRuleOption[] = [
    ...classes.map(([nameEn, name, hitDie, spellcastingAbility, savingThrowProficiencies]) => ({
      ...fallbackOption('class', name, nameEn), hitDie, ...(spellcastingAbility ? { spellcastingAbility } : {}), savingThrowProficiencies,
    })),
    ...races.map(([nameEn, name, abilityBonuses]) => ({ ...fallbackOption('race', name, nameEn), abilityBonuses, speed: 30, sizes: ['M'] })),
    ...backgrounds.map(([nameEn, name]) => fallbackOption('background', name, nameEn)),
  ];
  return {
    schemaVersion: DND5E_CHARACTER_RULE_CATALOG_SCHEMA_VERSION,
    generatedAt: 0,
    sourceName: 'DND5E 不全书 / 5etools-cn（基础离线索引）',
    sourceUrl: 'https://5echm.kagangtuya.top/',
    sources: DEFAULT_CHARACTER_RULE_SOURCES.map(source => ({ ...source })),
    options,
  };
}

export function enabledCharacterOptions(catalog: CharacterRuleCatalog, enabledSources: readonly string[]): CharacterRuleOption[] {
  const sources = new Set(['PHB', ...enabledSources]);
  return catalog.options.filter(option => sources.has(option.source));
}

export function characterRuleReference(option: CharacterRuleOption): CharacterRuleReference {
  return {
    id: option.id,
    kind: option.kind,
    name: option.name,
    nameEn: option.nameEn,
    source: option.source,
    ...(option.level === undefined ? {} : { level: option.level }),
    ...(option.kind === 'spell' ? { prepared: true } : {}),
  };
}

function fallbackOption(kind: CharacterRuleOptionKind, name: string, nameEn: string): CharacterRuleOption {
  return { id: `${kind}:PHB:${nameEn}`, kind, name, nameEn, source: 'PHB' };
}

function ruleSource(value: unknown): CharacterRuleSource {
  if (!isRecord(value)) throw new Error('invalid source');
  const id = requiredText(value.id, 32);
  if (!SOURCE_PATTERN.test(id)) throw new Error('invalid source id');
  return {
    id,
    name: requiredText(value.name, 160),
    abbreviation: requiredText(value.abbreviation, 40),
    core: value.core === true,
    description: text(value.description, '', 500),
  };
}

function ruleOption(value: unknown): CharacterRuleOption {
  if (!isRecord(value) || !OPTION_KINDS.includes(value.kind as CharacterRuleOptionKind)) throw new Error('invalid option');
  const source = requiredText(value.source, 32);
  if (!SOURCE_PATTERN.test(source)) throw new Error('invalid source');
  const option: CharacterRuleOption = {
    id: requiredText(value.id, 180),
    kind: value.kind as CharacterRuleOptionKind,
    name: requiredText(value.name, 160),
    nameEn: requiredText(value.nameEn, 160),
    source,
  };
  if (typeof value.level === 'number') option.level = integer(value.level, 0, 0, 20);
  if (typeof value.parentName === 'string') option.parentName = text(value.parentName, '', 160);
  if (Array.isArray(value.classNames)) option.classNames = stringList(value.classNames, 30, 120);
  if (typeof value.bookFile === 'string') option.bookFile = text(value.bookFile, '', 240);
  const bonuses = abilityNumberRecord(value.abilityBonuses, 0, 10);
  if (Object.keys(bonuses).length) option.abilityBonuses = bonuses;
  const choices = abilityBonusChoices(value.abilityBonusChoices);
  if (choices.length) option.abilityBonusChoices = choices;
  if (typeof value.speed === 'number') option.speed = integer(value.speed, 30, 0, 500);
  if (Array.isArray(value.sizes)) option.sizes = stringList(value.sizes, 10, 20);
  if (typeof value.hitDie === 'number') option.hitDie = integer(value.hitDie, 8, 4, 20);
  if (ABILITIES.includes(value.spellcastingAbility as AbilityKey)) option.spellcastingAbility = value.spellcastingAbility as AbilityKey;
  if (Array.isArray(value.savingThrowProficiencies)) option.savingThrowProficiencies = abilityList(value.savingThrowProficiencies, 6);
  for (const [key, maximum] of [
    ['skillProficiencies', 100], ['armorProficiencies', 100], ['weaponProficiencies', 100],
    ['toolProficiencies', 100], ['languageProficiencies', 100],
  ] as const) {
    if (Array.isArray(value[key])) option[key] = stringList(value[key], maximum, 120);
  }
  const skillChoices = proficiencyChoices(value.skillChoices);
  if (skillChoices.length) option.skillChoices = skillChoices;
  const features = featureList(value.features, source, 100);
  if (features.length) option.features = features;
  const equipment = startingEquipment(value.startingEquipment);
  if (equipment.length) option.startingEquipment = equipment;
  const spell = spellProfile(value.spell);
  if (spell) option.spell = spell;
  const item = itemProfile(value.item);
  if (item) option.item = item;
  return option;
}

function sourceList(value: unknown, fallback: readonly string[] = ['PHB']): string[] {
  const values = Array.isArray(value) ? value : fallback;
  const result = values.flatMap(item => typeof item === 'string' && SOURCE_PATTERN.test(item) ? [item] : []).slice(0, 50);
  return uniqueBy(['PHB', ...result], item => item);
}

function safeRuleReference(value: unknown, expectedKind: CharacterRuleOptionKind, enabledSources: readonly string[]): CharacterRuleReference | null {
  try {
    if (!isRecord(value) || value.kind !== expectedKind) return null;
    const source = requiredText(value.source, 32);
    if (!enabledSources.includes(source)) return null;
    return {
      id: requiredText(value.id, 180), kind: expectedKind, name: requiredText(value.name, 160),
      nameEn: requiredText(value.nameEn, 160), source,
      ...(typeof value.level === 'number' ? { level: integer(value.level, 0, 0, 20) } : {}),
      ...(expectedKind === 'spell' ? { prepared: value.prepared !== false } : {}),
    };
  } catch { return null; }
}

function referenceList(value: unknown, expectedKind: CharacterRuleOptionKind, enabledSources: readonly string[], maximum: number): CharacterRuleReference[] {
  if (!Array.isArray(value)) return [];
  return uniqueBy(value.slice(0, maximum).flatMap(item => {
    const reference = safeRuleReference(item, expectedKind, enabledSources);
    return reference ? [reference] : [];
  }), item => item.id);
}

function inventoryList(value: unknown, enabledSources: readonly string[]): CharacterInventoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const reference = item.item === null ? null : safeRuleReference(item.item, 'item', enabledSources);
    const name = text(item.name, reference?.name ?? '', 160);
    if (!name) return [];
    return [{
      id: text(item.id, `inventory-${index}`, 180), item: reference, name,
      quantity: integer(item.quantity, 1, 0, 100_000), weight: finiteNumber(item.weight, 0, 0, 100_000),
      equipped: item.equipped === true, attuned: item.attuned === true, notes: text(item.notes, '', 4000),
    }];
  });
}

function gearSection(value: unknown, enabledSources: readonly string[]): Dnd5eCharacterSheet['gear'] {
  const gear = record(value);
  return {
    armor: safeRuleReference(gear.armor, 'item', enabledSources),
    mainHand: weaponSlot(gear.mainHand, enabledSources),
    offHand: weaponSlot(gear.offHand, enabledSources),
  };
}

function weaponSlot(value: unknown, enabledSources: readonly string[]): CharacterWeaponSlot | null {
  if (!isRecord(value)) return null;
  const reference = safeRuleReference(value.reference, 'item', enabledSources);
  if (!reference) return null;
  return { reference, hitAdjust: integer(value.hitAdjust, 0, -20, 20), damageAdjust: integer(value.damageAdjust, 0, -20, 20) };
}

function abilityBonusChoices(value: unknown): CharacterAbilityBonusChoice[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap(item => {
    if (!isRecord(item)) return [];
    const amounts = Array.isArray(item.amounts) ? item.amounts.slice(0, 6).map(amount => integer(amount, 1, -5, 10)) : [];
    const from = abilityList(item.from, 6);
    return amounts.length && from.length ? [{ amounts, from, distinct: item.distinct !== false }] : [];
  });
}

function proficiencyChoices(value: unknown): CharacterProficiencyChoice[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap(item => {
    if (!isRecord(item)) return [];
    const from = stringList(item.from, 100, 80);
    return from.length ? [{ count: integer(item.count, 1, 1, 20), from }] : [];
  });
}

function featureList(value: unknown, defaultSource: string, maximum: number): CharacterRuleFeature[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maximum).flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const name = text(item.name, '', 160);
    if (!name) return [];
    return [{
      id: text(item.id, `${defaultSource}:${index}:${name}`, 180), name,
      source: text(item.source, defaultSource, 32),
      ...(typeof item.level === 'number' ? { level: integer(item.level, 1, 1, 20) } : {}),
      description: text(item.description, '', 2400),
    }];
  });
}

function startingEquipment(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap(item => isRecord(item) && typeof item.name === 'string'
    ? [{ name: text(item.name, '', 160), quantity: integer(item.quantity, 1, 1, 100_000) }]
    : []);
}

function spellProfile(value: unknown): CharacterSpellProfile | undefined {
  if (!isRecord(value)) return undefined;
  return {
    school: text(value.school, '', 80), castingTime: text(value.castingTime, '', 160), range: text(value.range, '', 160),
    duration: text(value.duration, '', 160), components: stringList(value.components, 10, 80),
    concentration: value.concentration === true, ritual: value.ritual === true, description: text(value.description, '', 2400),
  };
}

function itemProfile(value: unknown): CharacterItemProfile | undefined {
  if (!isRecord(value)) return undefined;
  const weaponCategory = text(value.weaponCategory, '', 40);
  const damageVersatile = text(value.damageVersatile, '', 80);
  return {
    category: text(value.category, 'equipment', 80), weight: finiteNumber(value.weight, 0, 0, 100_000),
    armorBase: nullableInteger(value.armorBase, 0, 100), armorDexCap: nullableInteger(value.armorDexCap, -10, 20),
    armorBonus: integer(value.armorBonus, 0, -20, 20), damage: text(value.damage, '', 80), damageType: text(value.damageType, '', 80),
    range: text(value.range, '', 80), description: text(value.description, '', 2400),
    ...(weaponCategory ? { weaponCategory } : {}),
    ...(damageVersatile ? { damageVersatile } : {}),
    ...(value.finesse === true ? { finesse: true } : {}),
    ...(value.light === true ? { light: true } : {}),
    ...(value.twoHanded === true ? { twoHanded: true } : {}),
    ...(value.thrown === true ? { thrown: true } : {}),
    ...(value.ammunition === true ? { ammunition: true } : {}),
    ...(value.reach === true ? { reach: true } : {}),
    ...(typeof value.bonusWeapon === 'number' ? { bonusWeapon: integer(value.bonusWeapon, 0, -20, 20) } : {}),
  };
}

function safeAvatarUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const url = value.trim();
  if (url.startsWith('/api/')) return url.slice(0, 500);
  try { const parsed = new URL(url); return parsed.protocol === 'https:' ? parsed.toString().slice(0, 500) : ''; }
  catch { return ''; }
}

function httpUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  try { const parsed = new URL(value); return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : fallback; }
  catch { return fallback; }
}

function abilityNumberRecord(value: unknown, minimum: number, maximum: number): Partial<Record<AbilityKey, number>> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(ABILITIES.flatMap(key => typeof value[key] === 'number' ? [[key, integer(value[key], 0, minimum, maximum)]] : []));
}

function numberRecord(value: unknown, minimum: number, maximum: number, limit: number): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, limit).flatMap(([key, item]) => typeof item === 'number'
    ? [[key.slice(0, 180), integer(item, 0, minimum, maximum)]] : []));
}

function abilityList(value: unknown, maximum: number): AbilityKey[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maximum).flatMap(item => ABILITIES.includes(item as AbilityKey) ? [item as AbilityKey] : []);
}

function stringList(value: unknown, maximum: number, itemMaximum: number): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueBy(value.slice(0, maximum).flatMap(item => typeof item === 'string' && item.trim() ? [item.trim().slice(0, itemMaximum)] : []), item => item);
}

function requiredText(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('text required');
  return value.trim().slice(0, maximum);
}

function text(value: unknown, fallback: string, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : fallback;
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, minimum, maximum) : fallback;
}

function nullableInteger(value: unknown, minimum: number, maximum: number): number | null {
  return value === null || value === undefined ? null : integer(value, minimum, minimum, maximum);
}

function finiteNumber(value: unknown, fallback: number, minimum = Number.NEGATIVE_INFINITY, maximum = Number.POSITIVE_INFINITY): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter(value => { const id = key(value); if (seen.has(id)) return false; seen.add(id); return true; });
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
