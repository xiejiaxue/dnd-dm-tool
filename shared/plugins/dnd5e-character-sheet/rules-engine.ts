import type { AbilityKey } from '../../tabletop-tools';
import {
  DND5E_POINT_BUY_BUDGET,
  type CharacterAbilityBonusChoice,
  type CharacterItemProfile,
  type CharacterRuleCatalog,
  type CharacterRuleOption,
  type CharacterWeaponSlot,
  type Dnd5eCharacterSheet,
  type Dnd5eDerivedCharacter,
  type DerivedAttack,
  type DerivedCharacterEquipment,
  type DerivedCharacterFeature,
  type DerivedSkill,
} from './types';

export const DND5E_ABILITIES: readonly AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const DND5E_SKILLS: ReadonlyArray<{ id: string; name: string; ability: AbilityKey }> = [
  { id: 'athletics', name: '运动', ability: 'str' },
  { id: 'acrobatics', name: '体操', ability: 'dex' },
  { id: 'sleight of hand', name: '巧手', ability: 'dex' },
  { id: 'stealth', name: '隐匿', ability: 'dex' },
  { id: 'arcana', name: '奥秘', ability: 'int' },
  { id: 'history', name: '历史', ability: 'int' },
  { id: 'investigation', name: '调查', ability: 'int' },
  { id: 'nature', name: '自然', ability: 'int' },
  { id: 'religion', name: '宗教', ability: 'int' },
  { id: 'animal handling', name: '驯兽', ability: 'wis' },
  { id: 'insight', name: '洞悉', ability: 'wis' },
  { id: 'medicine', name: '医药', ability: 'wis' },
  { id: 'perception', name: '察觉', ability: 'wis' },
  { id: 'survival', name: '求生', ability: 'wis' },
  { id: 'deception', name: '欺瞒', ability: 'cha' },
  { id: 'intimidation', name: '威吓', ability: 'cha' },
  { id: 'performance', name: '表演', ability: 'cha' },
  { id: 'persuasion', name: '游说', ability: 'cha' },
];

const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const FULL_CASTER_SLOTS: number[][] = [
  [], [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

export function pointBuyCost(score: number): number {
  return POINT_BUY_COST[Math.round(score)] ?? Number.POSITIVE_INFINITY;
}

export function characterAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function proficiencyBonus(level: number): number {
  return Math.min(6, 2 + Math.floor((Math.max(1, level) - 1) / 4));
}

export function flattenAbilityChoiceAmounts(choices: readonly CharacterAbilityBonusChoice[]): number[] {
  return choices.flatMap(choice => choice.amounts);
}

export function deriveDnd5eCharacter(sheet: Dnd5eCharacterSheet, catalog: CharacterRuleCatalog): Dnd5eDerivedCharacter {
  const options = new Map(catalog.options.map(option => [option.id, option]));
  const race = optionFor(options, sheet.advancement.race?.id);
  const characterClass = optionFor(options, sheet.advancement.class?.id);
  const subclass = optionFor(options, sheet.advancement.subclass?.id);
  const background = optionFor(options, sheet.advancement.background?.id);
  const racialBonuses = selectedAbilityBonuses(sheet, race, background);
  const abilities = Object.fromEntries(DND5E_ABILITIES.map(key => [
    key,
    clamp(sheet.abilityGeneration.base[key] + racialBonuses[key] + sheet.abilityGeneration.customBonuses[key], 1, 30),
  ])) as Record<AbilityKey, number>;
  const modifiers = Object.fromEntries(DND5E_ABILITIES.map(key => [key, characterAbilityModifier(abilities[key])])) as Record<AbilityKey, number>;
  const level = sheet.advancement.level;
  const proficiency = proficiencyBonus(level);
  const weaponProficiencyList = unique([...(race?.weaponProficiencies ?? []), ...(characterClass?.weaponProficiencies ?? []), ...sheet.training.weapons]);
  const savingProficiencies = unique(characterClass?.savingThrowProficiencies ?? []) as AbilityKey[];
  const savingThrows = Object.fromEntries(DND5E_ABILITIES.map(key => [
    key,
    modifiers[key] + (savingProficiencies.includes(key) ? proficiency : 0),
  ])) as Record<AbilityKey, number>;

  const automaticSkills = unique([
    ...(race?.skillProficiencies ?? []),
    ...(characterClass?.skillProficiencies ?? []),
    ...(background?.skillProficiencies ?? []),
  ]).map(normalizeSkill);
  const trained = unique([...automaticSkills, ...sheet.training.skills.map(normalizeSkill)]);
  const expertise = new Set(sheet.training.expertise.map(normalizeSkill));
  const skills: DerivedSkill[] = DND5E_SKILLS.map(skill => {
    const rank = expertise.has(skill.id) ? 2 : trained.includes(skill.id) ? 1 : 0;
    return { ...skill, rank, modifier: modifiers[skill.ability] + proficiency * rank };
  });
  const skillModifier = (id: string) => skills.find(skill => skill.id === id)?.modifier ?? 0;

  const equipment = deriveEquipment(sheet, options, characterClass, background);
  const armorClass = deriveArmorClass(sheet, modifiers.dex, options);
  const attacks = deriveAttacks(sheet, options, modifiers, proficiency, weaponProficiencyList);
  const hitDie = characterClass?.hitDie ?? 8;
  const defaultHitPoints = Math.max(1, hitDie + modifiers.con + Math.max(0, level - 1) * (Math.floor(hitDie / 2) + 1 + modifiers.con));
  const hitPointsMaximum = sheet.combat.hitPoints.maximumOverride ?? defaultHitPoints;
  const spellcastingAbility = characterClass?.spellcastingAbility ?? null;
  const spellSlots = spellSlotMaximums(characterClass, level).map((maximum, index) => {
    const slotLevel = index + 1;
    const used = clamp(sheet.play.spellSlotsUsed[String(slotLevel)] ?? 0, 0, maximum);
    return { level: slotLevel, maximum, used, remaining: maximum - used };
  }).filter(slot => slot.maximum > 0);
  const features = deriveFeatures(sheet, options, [race, characterClass, subclass, background], level);
  const pointBuySpent = DND5E_ABILITIES.reduce((sum, key) => sum + pointBuyCost(sheet.abilityGeneration.base[key]), 0);
  const equipmentWeight = equipment.reduce((sum, entry) => sum + entry.weight * entry.quantity, 0);

  return {
    abilities,
    modifiers,
    pointBuySpent,
    pointBuyRemaining: DND5E_POINT_BUY_BUDGET - pointBuySpent,
    pointBuyValid: Number.isFinite(pointBuySpent) && pointBuySpent <= DND5E_POINT_BUY_BUDGET,
    racialBonuses,
    proficiencyBonus: proficiency,
    savingThrows,
    savingThrowProficiencies: savingProficiencies,
    skills,
    initiative: modifiers.dex,
    passivePerception: 10 + skillModifier('perception'),
    passiveInsight: 10 + skillModifier('insight'),
    passiveInvestigation: 10 + skillModifier('investigation'),
    armorClass,
    attacks,
    speed: sheet.combat.speedOverride ?? race?.speed ?? 30,
    hitDie,
    hitPointsMaximum,
    hitDiceRemaining: Math.max(0, level - sheet.play.hitDiceSpent),
    spellcasting: {
      ability: spellcastingAbility,
      saveDc: spellcastingAbility ? 8 + proficiency + modifiers[spellcastingAbility] : null,
      attackBonus: spellcastingAbility ? proficiency + modifiers[spellcastingAbility] : null,
      slots: spellSlots,
    },
    proficiencies: {
      armor: unique([...(characterClass?.armorProficiencies ?? []), ...sheet.training.armor]),
      weapons: weaponProficiencyList,
      tools: unique([...(race?.toolProficiencies ?? []), ...(characterClass?.toolProficiencies ?? []), ...(background?.toolProficiencies ?? []), ...sheet.training.tools]),
      languages: unique([...(race?.languageProficiencies ?? []), ...(background?.languageProficiencies ?? []), ...sheet.training.languages]),
    },
    features,
    equipment,
    equipmentWeight,
    carryingCapacity: Math.max(0, abilities.str * 15),
  };
}

export function recalculateDnd5eCharacterSheet(sheet: Dnd5eCharacterSheet, catalog: CharacterRuleCatalog): Dnd5eCharacterSheet {
  const derived = deriveDnd5eCharacter(sheet, catalog);
  const oldMaximum = Math.max(1, sheet.combat.hitPoints.max);
  const currentWasFull = sheet.combat.hitPoints.current >= oldMaximum;
  const current = currentWasFull ? derived.hitPointsMaximum : Math.min(sheet.combat.hitPoints.current, derived.hitPointsMaximum);
  return {
    ...sheet,
    abilities: derived.abilities,
    combat: {
      ...sheet.combat,
      armorClass: derived.armorClass,
      speed: derived.speed,
      hitPoints: { ...sheet.combat.hitPoints, current, max: derived.hitPointsMaximum },
    },
  };
}

function selectedAbilityBonuses(
  sheet: Dnd5eCharacterSheet,
  race: CharacterRuleOption | undefined,
  background: CharacterRuleOption | undefined,
): Record<AbilityKey, number> {
  const result = Object.fromEntries(DND5E_ABILITIES.map(key => [key, 0])) as Record<AbilityKey, number>;
  if (!sheet.abilityGeneration.useRuleBonuses) return result;
  for (const option of [race, background]) {
    for (const key of DND5E_ABILITIES) result[key] += option?.abilityBonuses?.[key] ?? 0;
  }
  const choices = [...(race?.abilityBonusChoices ?? []), ...(background?.abilityBonusChoices ?? [])];
  let offset = 0;
  for (const choice of choices) {
    const used = new Set<AbilityKey>();
    choice.amounts.forEach((amount, index) => {
      const target = sheet.abilityGeneration.bonusChoices[offset + index];
      if (!target || !choice.from.includes(target) || (choice.distinct && used.has(target))) return;
      result[target] += amount;
      used.add(target);
    });
    offset += choice.amounts.length;
  }
  return result;
}

function deriveFeatures(
  sheet: Dnd5eCharacterSheet,
  options: ReadonlyMap<string, CharacterRuleOption>,
  origins: Array<CharacterRuleOption | undefined>,
  level: number,
): DerivedCharacterFeature[] {
  const result: DerivedCharacterFeature[] = [];
  for (const option of origins) {
    if (!option) continue;
    for (const feature of option.features ?? []) {
      if ((feature.level ?? 1) <= level) result.push({ ...feature, origin: option.name });
    }
  }
  for (const reference of sheet.feats) {
    const option = options.get(reference.id);
    const features = option?.features?.length ? option.features : [{ id: reference.id, name: reference.name, source: reference.source, description: '' }];
    for (const feature of features) result.push({ ...feature, origin: '专长' });
  }
  for (const feature of sheet.customFeatures) result.push({ ...feature, origin: '自定义' });
  return uniqueBy(result, feature => feature.id);
}

function deriveEquipment(
  sheet: Dnd5eCharacterSheet,
  options: ReadonlyMap<string, CharacterRuleOption>,
  characterClass: CharacterRuleOption | undefined,
  background: CharacterRuleOption | undefined,
): DerivedCharacterEquipment[] {
  const automatic = [...(characterClass?.startingEquipment ?? []), ...(background?.startingEquipment ?? [])]
    .map((entry, index): DerivedCharacterEquipment => ({
      id: `automatic-${index}-${entry.name}`,
      name: entry.name,
      quantity: entry.quantity,
      weight: 0,
      equipped: false,
      automatic: true,
      item: null,
      notes: '由职业或背景自动获得（默认装备选项）',
    }));
  const manual = sheet.inventory.map((entry): DerivedCharacterEquipment => ({
    ...entry,
    automatic: false,
    profile: entry.item ? options.get(entry.item.id)?.item : undefined,
    weight: entry.item ? options.get(entry.item.id)?.item?.weight ?? entry.weight : entry.weight,
  }));
  return [...automatic, ...manual];
}

function deriveAttacks(
  sheet: Dnd5eCharacterSheet,
  options: ReadonlyMap<string, CharacterRuleOption>,
  modifiers: Record<AbilityKey, number>,
  proficiency: number,
  weaponProficiencies: readonly string[],
): DerivedAttack[] {
  const proficiencyNames = unique(weaponProficiencies.map(cleanProficiencyName));
  const attacks: DerivedAttack[] = [];
  for (const slotName of ['mainHand', 'offHand'] as const) {
    const slot: CharacterWeaponSlot | null = sheet.gear[slotName];
    const profile = optionFor(options, slot?.reference.id)?.item;
    if (!slot || !profile?.damage) continue;
    const ranged = profile.category.startsWith('R');
    const abilityUsed: AbilityKey = profile.finesse
      ? (modifiers.str >= modifiers.dex ? 'str' : 'dex')
      : ranged ? 'dex' : 'str';
    const offHandReference = sheet.gear.offHand?.reference ?? null;
    const versatile = slotName === 'mainHand' && !offHandReference && profile.damageVersatile;
    const magic = profile.bonusWeapon ?? 0;
    const proficient = weaponProficiency({ weaponCategory: profile.weaponCategory, name: slot.reference.name, nameEn: slot.reference.nameEn }, proficiencyNames);
    const notes = [
      profile.finesse ? '灵巧' : '',
      ranged ? '远程' : '',
      versatile ? `两用 ${profile.damageVersatile}` : '',
      profile.weaponCategory && /^[简易军用]{2}$/.test(profile.weaponCategory) ? profile.weaponCategory : '',
      slotName === 'offHand' && !profile.light ? '非轻武器' : '',
      slotName === 'offHand' && profile.light ? '轻武器' : '',
      slotName === 'mainHand' && profile.twoHanded && offHandReference ? '双手武器' : '',
    ].filter(Boolean);
    attacks.push({
      slot: slotName,
      name: slot.reference.name,
      abilityUsed,
      proficient,
      attackBonus: proficiency + modifiers[abilityUsed] + magic + slot.hitAdjust,
      damage: versatile ? profile.damageVersatile! : profile.damage,
      damageBonus: (slotName === 'offHand' ? 0 : modifiers[abilityUsed]) + magic + slot.damageAdjust,
      damageType: profile.damageType,
      notes,
    });
  }
  return attacks;
}

function cleanProficiencyName(value: string): string {
  return value.replace(/^\{\@item\s*/, '').replace(/\}$/, '').trim();
}

function weaponProficiency(profile: { weaponCategory?: string; name: string; nameEn: string }, proficiencyNames: readonly string[]): boolean | null {
  if (!proficiencyNames.length) return null;
  const category = profile.weaponCategory === '简易' || profile.weaponCategory === '军用' ? profile.weaponCategory : null;
  if (category && proficiencyNames.includes(category)) return true;
  if (proficiencyNames.some(name => name && ((profile.name && (profile.name.includes(name) || name.includes(profile.name))) || (profile.nameEn && (profile.nameEn.includes(name) || name.includes(profile.nameEn)))))) return true;
  return false;
}

function deriveArmorClass(sheet: Dnd5eCharacterSheet, dexterityModifier: number, options: ReadonlyMap<string, CharacterRuleOption>): number {
  if (sheet.combat.armorClassOverride !== null) return sheet.combat.armorClassOverride;
  let armorClass = 10 + dexterityModifier;
  const armorProfile = optionFor(options, sheet.gear.armor?.id)?.item;
  if (armorProfile && armorProfile.armorBase !== null && !isShieldProfile(armorProfile)) {
    const dexterity = armorProfile.armorDexCap === null ? dexterityModifier : Math.min(armorProfile.armorDexCap, dexterityModifier);
    armorClass = Math.max(armorClass, armorProfile.armorBase + dexterity + armorProfile.armorBonus);
  }
  const offHandProfile = optionFor(options, sheet.gear.offHand?.reference.id)?.item;
  if (offHandProfile && isShieldProfile(offHandProfile)) armorClass += 2 + offHandProfile.armorBonus;
  return armorClass;
}

function isShieldProfile(profile: CharacterItemProfile): boolean {
  return profile.armorBase !== null && profile.category.startsWith('S');
}

function spellSlotMaximums(characterClass: CharacterRuleOption | undefined, level: number): number[] {
  if (!characterClass?.spellcastingAbility) return [];
  const normalized = characterClass.nameEn.toLocaleLowerCase();
  if (normalized.includes('warlock')) {
    const maximum = level === 1 ? 1 : level <= 10 ? 2 : level <= 16 ? 3 : 4;
    const slotLevel = level <= 2 ? 1 : level <= 4 ? 2 : level <= 6 ? 3 : level <= 8 ? 4 : 5;
    return Array.from({ length: slotLevel }, (_, index) => index === slotLevel - 1 ? maximum : 0);
  }
  const halfCaster = ['paladin', 'ranger'].some(name => normalized.includes(name));
  const halfRoundUp = ['artificer'].some(name => normalized.includes(name));
  const casterLevel = halfCaster ? Math.floor(level / 2) : halfRoundUp ? Math.ceil(level / 2) : level;
  return [...(FULL_CASTER_SLOTS[clamp(casterLevel, 0, 20)] ?? [])];
}

function optionFor(options: ReadonlyMap<string, CharacterRuleOption>, id: string | undefined): CharacterRuleOption | undefined {
  return id ? options.get(id) : undefined;
}

function normalizeSkill(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll('_', ' ');
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean) as T[])];
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}
