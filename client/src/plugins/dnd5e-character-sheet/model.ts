import {
  characterRuleReference,
  deriveDnd5eCharacter,
  flattenAbilityChoiceAmounts,
  recalculateDnd5eCharacterSheet,
  type AbilityKey,
  type CharacterRuleCatalog,
  type CharacterRuleOption,
  type CharacterRuleOptionKind,
  type CharacterRuleReference,
  type Dnd5eCharacterSheet,
} from '../../types';

export { deriveDnd5eCharacter, recalculateDnd5eCharacterSheet };

export function optionsForSheet(
  catalog: CharacterRuleCatalog,
  sheet: Dnd5eCharacterSheet,
  kind: CharacterRuleOptionKind,
): CharacterRuleOption[] {
  const enabled = new Set(['PHB', ...sheet.rules.enabledSources]);
  return catalog.options
    .filter(option => option.kind === kind && enabled.has(option.source))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
}

export function subclassesForSheet(catalog: CharacterRuleCatalog, sheet: Dnd5eCharacterSheet): CharacterRuleOption[] {
  const selectedClass = sheet.advancement.class;
  if (!selectedClass) return [];
  const identities = new Set([selectedClass.name, selectedClass.nameEn].map(normalize));
  return optionsForSheet(catalog, sheet, 'subclass')
    .filter(option => !option.parentName || identities.has(normalize(option.parentName)));
}

export function spellsForSheet(catalog: CharacterRuleCatalog, sheet: Dnd5eCharacterSheet): CharacterRuleOption[] {
  const selectedClass = sheet.advancement.class;
  const options = optionsForSheet(catalog, sheet, 'spell');
  if (!selectedClass) return options;
  const identities = new Set([selectedClass.name, selectedClass.nameEn].map(normalize));
  return options.filter(option => !option.classNames?.length || option.classNames.some(name => identities.has(normalize(name))));
}

export function itemsForSheet(catalog: CharacterRuleCatalog, sheet: Dnd5eCharacterSheet): CharacterRuleOption[] {
  return optionsForSheet(catalog, sheet, 'item');
}

export function abilityBonusChoiceSlots(catalog: CharacterRuleCatalog, sheet: Dnd5eCharacterSheet): Array<{
  amount: number;
  from: AbilityKey[];
  label: string;
}> {
  const option = (id: string | undefined) => catalog.options.find(entry => entry.id === id);
  const sources = [option(sheet.advancement.race?.id), option(sheet.advancement.background?.id)].filter(Boolean) as CharacterRuleOption[];
  const result: Array<{ amount: number; from: AbilityKey[]; label: string }> = [];
  for (const source of sources) {
    for (const choice of source.abilityBonusChoices ?? []) {
      flattenAbilityChoiceAmounts([choice]).forEach(amount => result.push({ amount, from: choice.from, label: source.name }));
    }
  }
  return result;
}

export function splitFeatOptions(
  catalog: CharacterRuleCatalog,
  sheet: Dnd5eCharacterSheet,
): { selected: CharacterRuleOption[]; available: CharacterRuleOption[] } {
  const options = optionsForSheet(catalog, sheet, 'feat');
  const byId = new Map(options.map(option => [option.id, option]));
  const selected = sheet.feats.flatMap(reference => byId.get(reference.id) ?? []);
  const selectedIds = new Set(selected.map(option => option.id));
  const available = options.filter(option => !selectedIds.has(option.id));
  return { selected, available };
}

const isShieldItem = (option: CharacterRuleOption) => option.item !== undefined && option.item.armorBase !== null && option.item.category.startsWith('S');

export function gearOptionsForSheet(catalog: CharacterRuleCatalog, sheet: Dnd5eCharacterSheet): {
  armorOptions: CharacterRuleOption[];
  weaponOptions: CharacterRuleOption[];
  offHandOptions: CharacterRuleOption[];
} {
  const items = optionsForSheet(catalog, sheet, 'item').filter(option => option.item);
  const armorOptions = items.filter(option => option.item!.armorBase !== null && !isShieldItem(option));
  const weaponOptions = items.filter(option => Boolean(option.item!.damage));
  const shieldOptions = items.filter(isShieldItem);
  return { armorOptions, weaponOptions, offHandOptions: [...weaponOptions, ...shieldOptions] };
}

export function resolveGearOption(catalog: CharacterRuleCatalog, reference: CharacterRuleReference | null | undefined): CharacterRuleOption | null {
  return reference ? catalog.options.find(option => option.id === reference.id && option.kind === 'item') ?? null : null;
}

export function setRuleSource(
  sheet: Dnd5eCharacterSheet,
  source: string,
  enabled: boolean,
): Dnd5eCharacterSheet {
  if (source === 'PHB') return sheet;
  const enabledSources = new Set(['PHB', ...sheet.rules.enabledSources]);
  if (enabled) enabledSources.add(source);
  else enabledSources.delete(source);
  const next = { ...sheet, rules: { ...sheet.rules, enabledSources: [...enabledSources] } };
  return removeDisabledReferences(next, enabledSources);
}

export function selectedReference(option: CharacterRuleOption | undefined): CharacterRuleReference | null {
  return option ? characterRuleReference(option) : null;
}

export function toggleRuleReference(
  current: readonly CharacterRuleReference[],
  option: CharacterRuleOption,
): CharacterRuleReference[] {
  return current.some(item => item.id === option.id)
    ? current.filter(item => item.id !== option.id)
    : [...current, characterRuleReference(option)];
}

function removeDisabledReferences(sheet: Dnd5eCharacterSheet, enabled: ReadonlySet<string>): Dnd5eCharacterSheet {
  const allowed = (reference: CharacterRuleReference | null | undefined) => !reference || enabled.has(reference.source);
  const characterClass = allowed(sheet.advancement.class) ? sheet.advancement.class : null;
  const subclass = characterClass && allowed(sheet.advancement.subclass) ? sheet.advancement.subclass : null;
  return {
    ...sheet,
    advancement: {
      ...sheet.advancement,
      race: allowed(sheet.advancement.race) ? sheet.advancement.race : null,
      class: characterClass,
      subclass,
      background: allowed(sheet.advancement.background) ? sheet.advancement.background : null,
    },
    feats: sheet.feats.filter(allowed),
    spells: sheet.spells.filter(allowed),
    inventory: sheet.inventory.filter(entry => !entry.item || allowed(entry.item)),
    gear: {
      armor: allowed(sheet.gear.armor) ? sheet.gear.armor : null,
      mainHand: allowed(sheet.gear.mainHand?.reference) ? sheet.gear.mainHand : null,
      offHand: allowed(sheet.gear.offHand?.reference) ? sheet.gear.offHand : null,
    },
  };
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}
