import type { AbilityKey, Dnd5eActorSystem, OwnedItem } from '../../tabletop-tools';

export const DND5E_CHARACTER_SHEET_PLUGIN_ID = 'dnd5e-character-sheet';
export const DND5E_CHARACTER_SHEET_SCHEMA_VERSION = 2 as const;
export const DND5E_CHARACTER_RULE_CATALOG_SCHEMA_VERSION = 1 as const;
export const DND5E_POINT_BUY_BUDGET = 27 as const;

export type CharacterRuleOptionKind = 'race' | 'class' | 'subclass' | 'background' | 'feat' | 'spell' | 'item';

export interface CharacterRuleSource {
  id: string;
  name: string;
  abbreviation: string;
  core: boolean;
  description: string;
}

export interface CharacterAbilityBonusChoice {
  amounts: number[];
  from: AbilityKey[];
  distinct: boolean;
}

export interface CharacterProficiencyChoice {
  count: number;
  from: string[];
}

export interface CharacterRuleFeature {
  id: string;
  name: string;
  source: string;
  level?: number;
  description: string;
}

export interface CharacterStartingEquipment {
  name: string;
  quantity: number;
}

export interface CharacterSpellProfile {
  school: string;
  castingTime: string;
  range: string;
  duration: string;
  components: string[];
  concentration: boolean;
  ritual: boolean;
  description: string;
}

export interface CharacterItemProfile {
  category: string;
  weight: number;
  armorBase: number | null;
  armorDexCap: number | null;
  armorBonus: number;
  damage: string;
  damageType: string;
  range: string;
  description: string;
  weaponCategory?: string;
  damageVersatile?: string;
  finesse?: boolean;
  light?: boolean;
  twoHanded?: boolean;
  thrown?: boolean;
  ammunition?: boolean;
  reach?: boolean;
  bonusWeapon?: number;
}

export interface CharacterRuleOption {
  id: string;
  kind: CharacterRuleOptionKind;
  name: string;
  nameEn: string;
  source: string;
  level?: number;
  parentName?: string;
  classNames?: string[];
  bookFile?: string;
  abilityBonuses?: Partial<Record<AbilityKey, number>>;
  abilityBonusChoices?: CharacterAbilityBonusChoice[];
  speed?: number;
  sizes?: string[];
  hitDie?: number;
  spellcastingAbility?: AbilityKey;
  savingThrowProficiencies?: AbilityKey[];
  skillProficiencies?: string[];
  skillChoices?: CharacterProficiencyChoice[];
  armorProficiencies?: string[];
  weaponProficiencies?: string[];
  toolProficiencies?: string[];
  languageProficiencies?: string[];
  features?: CharacterRuleFeature[];
  startingEquipment?: CharacterStartingEquipment[];
  spell?: CharacterSpellProfile;
  item?: CharacterItemProfile;
}

export interface CharacterRuleCatalog {
  schemaVersion: typeof DND5E_CHARACTER_RULE_CATALOG_SCHEMA_VERSION;
  generatedAt: number;
  sourceName: string;
  sourceUrl: string;
  sources: CharacterRuleSource[];
  options: CharacterRuleOption[];
}

export interface CharacterRuleReference {
  id: string;
  kind: CharacterRuleOptionKind;
  name: string;
  nameEn: string;
  source: string;
  level?: number;
  prepared?: boolean;
}

export interface PointBuyAbilityGeneration {
  method: 'pointBuy';
  base: Record<AbilityKey, number>;
  useRuleBonuses: boolean;
  bonusChoices: AbilityKey[];
  customBonuses: Record<AbilityKey, number>;
}

export interface CharacterTraining {
  skills: string[];
  expertise: string[];
  armor: string[];
  weapons: string[];
  tools: string[];
  languages: string[];
}

export interface CharacterInventoryEntry {
  id: string;
  item: CharacterRuleReference | null;
  name: string;
  quantity: number;
  weight: number;
  equipped: boolean;
  attuned: boolean;
  notes: string;
}

export interface CharacterWeaponSlot {
  reference: CharacterRuleReference;
  hitAdjust: number;
  damageAdjust: number;
}

export interface CharacterRoleplay {
  personalityTraits: string;
  ideals: string;
  bonds: string;
  flaws: string;
  faith: string;
  organizations: string;
}

export interface CharacterPlayState {
  inspiration: boolean;
  deathSaves: { successes: number; failures: number };
  hitDiceSpent: number;
  spellSlotsUsed: Record<string, number>;
  featureUses: Record<string, number>;
  conditions: string[];
}

export interface Dnd5eCharacterSheet {
  schemaVersion: typeof DND5E_CHARACTER_SHEET_SCHEMA_VERSION;
  rules: {
    coreSource: 'PHB';
    enabledSources: string[];
  };
  identity: {
    characterName: string;
    playerName: string;
    pronouns: string;
    alignment: string;
    avatarUrl: string;
    age: string;
    size: string;
    faith: string;
  };
  advancement: {
    level: number;
    experience: number;
    race: CharacterRuleReference | null;
    class: CharacterRuleReference | null;
    subclass: CharacterRuleReference | null;
    background: CharacterRuleReference | null;
  };
  abilityGeneration: PointBuyAbilityGeneration;
  abilities: Record<AbilityKey, number>;
  combat: {
    armorClass: number;
    armorClassOverride: number | null;
    speed: number;
    speedOverride: number | null;
    hitPoints: { current: number; max: number; maximumOverride: number | null; temporary: number };
  };
  training: CharacterTraining;
  feats: CharacterRuleReference[];
  spells: CharacterRuleReference[];
  inventory: CharacterInventoryEntry[];
  gear: { armor: CharacterRuleReference | null; mainHand: CharacterWeaponSlot | null; offHand: CharacterWeaponSlot | null };
  currency: { cp: number; sp: number; ep: number; gp: number; pp: number };
  play: CharacterPlayState;
  roleplay: CharacterRoleplay;
  customFeatures: CharacterRuleFeature[];
  biography: string;
  notes: string;
}

export interface DerivedSkill {
  id: string;
  name: string;
  ability: AbilityKey;
  rank: 0 | 1 | 2;
  modifier: number;
}

export interface DerivedSpellSlot {
  level: number;
  maximum: number;
  used: number;
  remaining: number;
}

export interface DerivedCharacterFeature extends CharacterRuleFeature {
  origin: string;
}

export interface DerivedCharacterEquipment {
  id: string;
  name: string;
  quantity: number;
  weight: number;
  equipped: boolean;
  automatic: boolean;
  item: CharacterRuleReference | null;
  profile?: CharacterItemProfile;
  notes: string;
}

export interface DerivedAttack {
  slot: 'mainHand' | 'offHand';
  name: string;
  abilityUsed: AbilityKey;
  proficient: boolean | null;
  attackBonus: number;
  damage: string;
  damageBonus: number;
  damageType: string;
  notes: string[];
}

export interface Dnd5eDerivedCharacter {
  abilities: Record<AbilityKey, number>;
  modifiers: Record<AbilityKey, number>;
  pointBuySpent: number;
  pointBuyRemaining: number;
  pointBuyValid: boolean;
  racialBonuses: Record<AbilityKey, number>;
  proficiencyBonus: number;
  savingThrows: Record<AbilityKey, number>;
  savingThrowProficiencies: AbilityKey[];
  skills: DerivedSkill[];
  initiative: number;
  passivePerception: number;
  passiveInsight: number;
  passiveInvestigation: number;
  armorClass: number;
  attacks: DerivedAttack[];
  speed: number;
  hitDie: number;
  hitPointsMaximum: number;
  hitDiceRemaining: number;
  spellcasting: {
    ability: AbilityKey | null;
    saveDc: number | null;
    attackBonus: number | null;
    slots: DerivedSpellSlot[];
  };
  proficiencies: {
    armor: string[];
    weapons: string[];
    tools: string[];
    languages: string[];
  };
  features: DerivedCharacterFeature[];
  equipment: DerivedCharacterEquipment[];
  equipmentWeight: number;
  carryingCapacity: number;
}

export interface PersonalCharacter {
  id: string;
  ownerUserId: string;
  name: string;
  color: string;
  sheet: Dnd5eCharacterSheet;
  status: 'active' | 'retired';
  createdAt: number;
  updatedAt: number;
}

export interface ImportedCharacterResult {
  actorId: string;
  characterId: string;
  claimedAt: number;
}

export interface CharacterSheetPluginManifest {
  id: typeof DND5E_CHARACTER_SHEET_PLUGIN_ID;
  title: string;
  version: string;
  requiredCore: string;
  dataSource: { name: string; url: string };
  standalonePath: '/characters';
}

export const DND5E_CHARACTER_SHEET_PLUGIN_MANIFEST: CharacterSheetPluginManifest = Object.freeze({
  id: DND5E_CHARACTER_SHEET_PLUGIN_ID,
  title: 'D&D 5e 角色卡',
  version: '2.0.0',
  requiredCore: '>=0.1.0',
  dataSource: {
    name: 'DND5E 不全书 / 5etools-cn',
    url: 'https://5echm.kagangtuya.top/',
  },
  standalonePath: '/characters',
});

export const DEFAULT_CHARACTER_RULE_SOURCES: readonly CharacterRuleSource[] = Object.freeze([
  { id: 'PHB', abbreviation: 'PHB14', name: '玩家手册 2014', core: true, description: '当前角色卡的基础规则，始终启用。' },
  { id: 'XPHB', abbreviation: 'PHB24', name: '玩家手册 2024', core: false, description: '2024 版玩家规则；与 2014 内容混用前请与主持人确认。' },
  { id: 'XGE', abbreviation: 'XGE', name: '珊娜萨的万事指南', core: false, description: '职业选项、专长与法术扩展。' },
  { id: 'TCE', abbreviation: 'TCE', name: '塔莎的万事坩埚', core: false, description: '可选职业特性、子职业、专长与法术扩展。' },
  { id: 'SCAG', abbreviation: 'SCAG', name: '剑湾冒险者指南', core: false, description: '剑湾种族与职业选项。' },
  { id: 'VGM', abbreviation: 'VGM', name: '沃罗的怪物指南', core: false, description: '额外可玩种族。' },
  { id: 'MPMM', abbreviation: 'MPMM', name: '魔邓肯巨献：多元宇宙怪物', core: false, description: '《Mordenkainen Presents: Monsters of the Multiverse》的修订可玩种族。' },
  { id: 'FTD', abbreviation: 'FTD', name: '费资本的巨龙宝库', core: false, description: '龙裔、专长与龙主题法术。' },
  { id: 'ERLW', abbreviation: 'ERLW', name: '艾伯伦：从终末战争中崛起', core: false, description: '经典艾伯伦种族、龙纹、背景、专长、魔法物品和怪物资料。' },
  { id: 'EFA', abbreviation: 'EFA', name: '艾伯伦：奇械锻炉', core: false, description: '新版奇械师、子职业、龙纹专长、魔法物品、法术和怪物资料。' },
  { id: 'EGW', abbreviation: 'EGW', name: '探索者荒野指南', core: false, description: '荒洲角色选项与法术。' },
]);

export function defaultEnabledCharacterRuleSourceIds(
  sources: readonly Pick<CharacterRuleSource, 'id'>[] = DEFAULT_CHARACTER_RULE_SOURCES,
): string[] {
  return sources.filter(source => source.id !== 'XPHB').map(source => source.id);
}

const TEN_ABILITIES: Record<AbilityKey, number> = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
const ZERO_ABILITIES: Record<AbilityKey, number> = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };

export function emptyDnd5eCharacterSheet(
  characterName = '',
  enabledSources: readonly string[] = defaultEnabledCharacterRuleSourceIds(),
): Dnd5eCharacterSheet {
  return {
    schemaVersion: DND5E_CHARACTER_SHEET_SCHEMA_VERSION,
    rules: { coreSource: 'PHB', enabledSources: [...new Set(['PHB', ...enabledSources])] },
    identity: { characterName, playerName: '', pronouns: '', alignment: '', avatarUrl: '', age: '', size: '', faith: '' },
    advancement: { level: 1, experience: 0, race: null, class: null, subclass: null, background: null },
    abilityGeneration: { method: 'pointBuy', base: { ...TEN_ABILITIES }, useRuleBonuses: true, bonusChoices: [], customBonuses: { ...ZERO_ABILITIES } },
    abilities: { ...TEN_ABILITIES },
    combat: {
      armorClass: 10,
      armorClassOverride: null,
      speed: 30,
      speedOverride: null,
      hitPoints: { current: 1, max: 1, maximumOverride: null, temporary: 0 },
    },
    training: { skills: [], expertise: [], armor: [], weapons: [], tools: [], languages: [] },
    feats: [],
    spells: [],
    inventory: [],
    gear: { armor: null, mainHand: null, offHand: null },
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    play: {
      inspiration: false,
      deathSaves: { successes: 0, failures: 0 },
      hitDiceSpent: 0,
      spellSlotsUsed: {},
      featureUses: {},
      conditions: [],
    },
    roleplay: { personalityTraits: '', ideals: '', bonds: '', flaws: '', faith: '', organizations: '' },
    customFeatures: [],
    biography: '',
    notes: '',
  };
}

export function personalCharacterActorSystemFromDerived(
  character: PersonalCharacter,
  derived: Dnd5eDerivedCharacter,
): Dnd5eActorSystem {
  const sheet = character.sheet;
  const featureItems = derived.features.map(featureItem);
  const spellItems = sheet.spells.map(referenceItem('spell'));
  const inventory = derived.equipment.map(equipmentItem);
  return {
    level: sheet.advancement.level,
    proficiency: derived.proficiencyBonus,
    armorClass: derived.armorClass,
    speed: derived.speed,
    hitPoints: {
      current: Math.min(sheet.combat.hitPoints.current, derived.hitPointsMaximum),
      max: derived.hitPointsMaximum,
      temporary: sheet.combat.hitPoints.temporary,
    },
    abilities: { ...derived.abilities },
    skills: Object.fromEntries(derived.skills.map(skill => [skill.id, skill.modifier])),
    resources: [
      ...derived.spellcasting.slots.map(slot => ({ id: `spell-slot-${slot.level}`, name: `${slot.level}环法术位`, current: slot.remaining, max: slot.maximum })),
      { id: 'hit-dice', name: `生命骰 d${derived.hitDie}`, current: derived.hitDiceRemaining, max: sheet.advancement.level },
    ],
    biography: [
      sheet.advancement.race?.name,
      sheet.advancement.class?.name,
      sheet.advancement.subclass?.name,
      sheet.advancement.background?.name,
      sheet.biography,
    ].filter(Boolean).join(' · '),
    notes: sheet.notes,
    actions: [],
    items: [...inventory, ...featureItems, ...spellItems],
    effects: [],
  };
}

function featureItem(feature: DerivedCharacterFeature): OwnedItem {
  return {
    id: crypto.randomUUID(),
    sourceItemId: feature.id,
    name: feature.name,
    itemType: 'feat',
    image: '',
    quantity: 1,
    equipped: false,
    description: feature.description,
    system: { source: feature.source, origin: feature.origin, ...(feature.level === undefined ? {} : { level: feature.level }) },
    actions: [],
    effects: [],
  };
}

function referenceItem(itemType: 'feat' | 'spell'): (reference: CharacterRuleReference) => OwnedItem {
  return reference => ({
    id: crypto.randomUUID(),
    sourceItemId: reference.id,
    name: reference.name,
    itemType,
    image: '',
    quantity: 1,
    equipped: itemType === 'spell' ? reference.prepared !== false : false,
    description: `${reference.nameEn} · ${reference.source}`,
    system: { source: reference.source, ruleId: reference.id, ...(reference.level === undefined ? {} : { level: reference.level }) },
    actions: [],
    effects: [],
  });
}

function equipmentItem(entry: DerivedCharacterEquipment): OwnedItem {
  return {
    id: entry.id,
    sourceItemId: entry.item?.id ?? null,
    name: entry.name,
    itemType: entry.profile?.damage ? 'weapon' : entry.profile?.armorBase ? 'armor' : 'equipment',
    image: '',
    quantity: entry.quantity,
    equipped: entry.equipped,
    description: entry.notes || entry.profile?.description || (entry.automatic ? '由职业或背景自动获得' : ''),
    system: {
      weight: entry.weight,
      automatic: entry.automatic,
      ...(entry.profile?.damage ? { damage: entry.profile.damage, damageType: entry.profile.damageType, range: entry.profile.range } : {}),
    },
    actions: [],
    effects: [],
  };
}
