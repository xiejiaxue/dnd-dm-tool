// Build the compact, plugin-owned character option catalog from the locally
// mirrored 5etools-cn data. It stores indices and references only; rule text
// remains in the reference compendium.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(ROOT, 'data', 'db');
const OUTPUT = path.join(DB, 'character-options.json');

const SOURCE_DEFINITIONS = [
  ['PHB', 'PHB14', '玩家手册 2014', true, '当前角色卡的基础规则，始终启用。'],
  ['XPHB', 'PHB24', '玩家手册 2024', false, '2024 版玩家规则；与 2014 内容混用前请与主持人确认。'],
  ['XGE', 'XGE', '珊娜萨的万事指南', false, '职业选项、专长与法术扩展。'],
  ['TCE', 'TCE', '塔莎的万事坩埚', false, '可选职业特性、子职业、专长与法术扩展。'],
  ['SCAG', 'SCAG', '剑湾冒险者指南', false, '剑湾种族与职业选项。'],
  ['VGM', 'VGM', '沃罗的怪物指南', false, '额外可玩种族。'],
  ['MPMM', 'MPMM', '魔邓肯巨献：多元宇宙怪物', false, '《Mordenkainen Presents: Monsters of the Multiverse》的修订可玩种族。'],
  ['FTD', 'FTD', '费资本的巨龙宝库', false, '龙裔、专长与龙主题法术。'],
  ['ERLW', 'ERLW', '艾伯伦：从终末战争中崛起', false, '经典艾伯伦种族、龙纹、背景、专长、魔法物品和怪物资料。'],
  ['EFA', 'EFA', '艾伯伦：奇械锻炉', false, '新版奇械师、子职业、龙纹专长、魔法物品、法术和怪物资料。'],
  ['EGW', 'EGW', '探索者荒野指南', false, '荒洲角色选项与法术。'],
];
const ALLOWED_SOURCES = new Set(SOURCE_DEFINITIONS.map(([id]) => id));
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

const FALLBACK_OPTIONS = {
  class: [
    ['Barbarian', '野蛮人'], ['Bard', '吟游诗人'], ['Cleric', '牧师'], ['Druid', '德鲁伊'],
    ['Fighter', '战士'], ['Monk', '武僧'], ['Paladin', '圣武士'], ['Ranger', '游侠'],
    ['Rogue', '游荡者'], ['Sorcerer', '术士'], ['Warlock', '魔契师'], ['Wizard', '法师'],
  ],
  race: [
    ['Dwarf', '矮人'], ['Elf', '精灵'], ['Halfling', '半身人'], ['Human', '人类'],
    ['Dragonborn', '龙裔'], ['Gnome', '侏儒'], ['Half-Elf', '半精灵'], ['Half-Orc', '半兽人'], ['Tiefling', '提夫林'],
  ],
  background: [
    ['Acolyte', '侍僧'], ['Charlatan', '骗子'], ['Criminal', '罪犯'], ['Entertainer', '艺人'],
    ['Folk Hero', '平民英雄'], ['Guild Artisan', '公会工匠'], ['Hermit', '隐士'], ['Noble', '贵族'],
    ['Outlander', '化外之民'], ['Sage', '智者'], ['Sailor', '水手'], ['Soldier', '士兵'], ['Urchin', '流浪儿'],
  ],
};

export function buildCharacterRuleCatalog(databaseDirectory = DB, outputFile = OUTPUT) {
  const options = [];
  const spellSourceLookup = readJsonOrEmpty(path.join(databaseDirectory, 'generated', 'gendata-spell-source-lookup.json'));
  for (const file of jsonFiles(databaseDirectory)) {
    if (path.basename(file) === 'character-options.json' || path.basename(file) === 'index.json') continue;
    let document;
    try { document = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) {
      console.warn(`[character-rules] SKIP ${file}: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    const bookFile = path.relative(databaseDirectory, file).split(path.sep).join('/');
    appendEntries(options, document.race, 'race', bookFile, spellSourceLookup, document);
    appendEntries(options, document.class, 'class', bookFile, spellSourceLookup, document);
    appendEntries(options, document.subclass, 'subclass', bookFile, spellSourceLookup, document);
    appendEntries(options, document.background, 'background', bookFile, spellSourceLookup, document);
    appendEntries(options, document.feat, 'feat', bookFile, spellSourceLookup, document);
    appendEntries(options, document.spell, 'spell', bookFile, spellSourceLookup, document);
    appendEntries(options, document.item, 'item', bookFile, spellSourceLookup, document);
    appendEntries(options, document.baseitem, 'item', bookFile, spellSourceLookup, document);
  }

  for (const [kind, fallback] of Object.entries(FALLBACK_OPTIONS)) {
    if (options.some(option => option.kind === kind && option.source === 'PHB')) continue;
    for (const [nameEn, name] of fallback) options.push(makeOption({ name, ENG_name: nameEn, source: 'PHB' }, kind, 'fallback'));
  }

  const deduplicated = uniqueBy(options.filter(Boolean), option => option.id)
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name, 'zh-Hans-CN'));
  const catalog = {
    schemaVersion: 1,
    generatedAt: Date.now(),
    sourceName: 'DND5E 不全书 / 5etools-cn',
    sourceUrl: 'https://5echm.kagangtuya.top/',
    sources: SOURCE_DEFINITIONS.map(([id, abbreviation, name, core, description]) => ({ id, abbreviation, name, core, description })),
    options: deduplicated,
  };
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(catalog));
  console.log(`[character-rules] ${deduplicated.length} options -> ${outputFile}`);
  return catalog;
}

function appendEntries(target, entries, kind, bookFile, spellSourceLookup, document) {
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    const option = makeOption(entry, kind, bookFile, spellSourceLookup, document);
    if (option) target.push(option);
  }
}

function makeOption(entry, kind, bookFile, spellSourceLookup = {}, document = {}) {
  if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.source !== 'string') return null;
  const source = entry.source.trim();
  if (!ALLOWED_SOURCES.has(source)) return null;
  const name = entry.name.trim();
  const nameEn = typeof entry.ENG_name === 'string' && entry.ENG_name.trim() ? entry.ENG_name.trim() : name;
  if (!name || !nameEn) return null;
  const classNames = kind === 'spell' ? spellClassNames(entry, name, nameEn, spellSourceLookup) : [];
  const parentName = kind === 'subclass'
    ? firstText(entry.className, entry.classNameShort, entry.classSource)
    : '';
  const profile = optionProfile(entry, kind, document);
  return {
    id: `${kind}:${source}:${nameEn}`.slice(0, 180),
    kind,
    name: name.slice(0, 160),
    nameEn: nameEn.slice(0, 160),
    source,
    ...(Number.isFinite(entry.level) ? { level: Math.max(0, Math.min(20, Math.round(entry.level))) } : {}),
    ...(parentName ? { parentName: parentName.slice(0, 160) } : {}),
    ...(classNames.length ? { classNames } : {}),
    ...(bookFile !== 'fallback' ? { bookFile } : {}),
    ...profile,
  };
}

function optionProfile(entry, kind, document) {
  if (kind === 'race') return ancestryProfile(entry);
  if (kind === 'class') return classProfile(entry, document.classFeature);
  if (kind === 'subclass') return subclassProfile(entry, document.subclassFeature);
  if (kind === 'background') return backgroundProfile(entry);
  if (kind === 'feat') return { features: featureSummaries(entry.entries, entry.source, `${kind}:${entry.source}:${entry.ENG_name || entry.name}`) };
  if (kind === 'spell') return { spell: spellProfile(entry) };
  if (kind === 'item') return { item: itemProfile(entry) };
  return {};
}

function ancestryProfile(entry) {
  const ability = hasAbilityProfile(entry.ability) ? abilityProfile(entry.ability) : lineageAbilityProfile(entry);
  const proficiencies = proficienciesFrom(entry);
  return compact({
    ...ability,
    speed: walkingSpeed(entry.speed),
    sizes: Array.isArray(entry.size) ? entry.size.filter(value => typeof value === 'string').slice(0, 10) : undefined,
    ...proficiencies,
    features: featureSummaries(entry.entries, entry.source, `race:${entry.source}:${entry.ENG_name || entry.name}`),
  });
}

function classProfile(entry, records) {
  const starting = isRecord(entry.startingProficiencies) ? entry.startingProficiencies : {};
  const proficiencies = proficienciesFrom(starting);
  const featureRecords = Array.isArray(records) ? records.filter(feature =>
    isRecord(feature)
    && identityMatches(feature.className, entry.name, entry.ENG_name)
    && (feature.classSource === undefined || feature.classSource === entry.source)
    && ALLOWED_SOURCES.has(feature.source || entry.source)) : [];
  return compact({
    hitDie: isRecord(entry.hd) && Number.isFinite(entry.hd.faces) ? entry.hd.faces : undefined,
    spellcastingAbility: spellcastingAbility(entry),
    savingThrowProficiencies: Array.isArray(entry.proficiency) ? entry.proficiency.filter(isAbility).slice(0, 6) : undefined,
    ...proficiencies,
    features: featureRecords.slice(0, 80).map((feature, index) => ({
      id: `class-feature:${feature.source || entry.source}:${feature.ENG_name || feature.name}:${feature.level || 1}`.slice(0, 180),
      name: firstText(feature.name, feature.ENG_name).slice(0, 160),
      source: firstText(feature.source, entry.source).slice(0, 32),
      level: integer(feature.level, 1, 1, 20),
      description: plainText(feature.entries).slice(0, 2400),
    })).filter(feature => feature.name),
    startingEquipment: equipmentEntries(entry.startingEquipment),
  });
}

function subclassProfile(entry, records) {
  const featureRecords = Array.isArray(records) ? records.filter(feature =>
    isRecord(feature)
    && identityMatches(feature.subclassShortName || feature.subclassName, entry.shortName || entry.name, entry.ENG_name)
    && identityMatches(feature.className, entry.className, entry.classNameShort)
    && ALLOWED_SOURCES.has(feature.source || entry.source)) : [];
  return compact({
    features: featureRecords.slice(0, 80).map(feature => ({
      id: `subclass-feature:${feature.source || entry.source}:${feature.ENG_name || feature.name}:${feature.level || 1}`.slice(0, 180),
      name: firstText(feature.name, feature.ENG_name).slice(0, 160),
      source: firstText(feature.source, entry.source).slice(0, 32),
      level: integer(feature.level, 1, 1, 20),
      description: plainText(feature.entries).slice(0, 2400),
    })).filter(feature => feature.name),
  });
}

function backgroundProfile(entry) {
  return compact({
    ...abilityProfile(entry.ability),
    ...proficienciesFrom(entry),
    features: featureSummaries(entry.entries, entry.source, `background:${entry.source}:${entry.ENG_name || entry.name}`),
    startingEquipment: equipmentEntries(entry.startingEquipment),
  });
}

// 5etools-cn 镜像没有为血统式种族（lineage 标记，如 MPMM 重印种族与 FTD 龙裔变体）
// 存储结构化的 ability 数据；这些种族的规则统一为“一项属性 +2、另一项不同属性 +1”。
function lineageAbilityProfile(entry) {
  if (!entry.lineage) return {};
  return { abilityBonusChoices: [{ amounts: [2, 1], from: [...ABILITIES], distinct: true }] };
}

function hasAbilityProfile(entries) {
  if (!Array.isArray(entries) || !entries.length) return false;
  return entries.some(entry => isRecord(entry) && (
    ABILITIES.some(ability => Number.isFinite(entry[ability]))
    || (isRecord(entry.choose) && (Array.isArray(entry.choose.from) || isRecord(entry.choose.weighted)))
  ));
}

function abilityProfile(entries) {
  if (!Array.isArray(entries) || !entries.length) return {};
  const fixed = {};
  const choices = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    for (const ability of ABILITIES) if (Number.isFinite(entry[ability])) fixed[ability] = (fixed[ability] || 0) + integer(entry[ability], 0, -5, 10);
    if (!isRecord(entry.choose)) continue;
    const choose = entry.choose;
    if (Array.isArray(choose.from)) {
      const from = choose.from.filter(isAbility);
      const amount = integer(choose.amount, 1, -5, 10);
      const count = integer(choose.count, 1, 1, 6);
      if (from.length) choices.push({ amounts: Array(count).fill(amount), from, distinct: true });
    }
    if (isRecord(choose.weighted) && Array.isArray(choose.weighted.from) && Array.isArray(choose.weighted.weights)) {
      const from = choose.weighted.from.filter(isAbility);
      const amounts = choose.weighted.weights.filter(Number.isFinite).slice(0, 6).map(value => integer(value, 1, -5, 10));
      if (from.length && amounts.length) choices.push({ amounts, from, distinct: true });
    }
  }
  return compact({ abilityBonuses: Object.keys(fixed).length ? fixed : undefined, abilityBonusChoices: choices.length ? choices : undefined });
}

function proficienciesFrom(entry) {
  const skills = proficiencyProfile(entry.skillProficiencies || entry.skills);
  return compact({
    skillProficiencies: skills.fixed,
    skillChoices: skills.choices,
    armorProficiencies: fixedProficiencies(entry.armorProficiencies || entry.armor),
    weaponProficiencies: fixedProficiencies(entry.weaponProficiencies || entry.weapons),
    toolProficiencies: fixedProficiencies(entry.toolProficiencies || entry.tools),
    languageProficiencies: fixedProficiencies(entry.languageProficiencies || entry.languages),
  });
}

function proficiencyProfile(entries) {
  const fixed = [];
  const choices = [];
  if (!Array.isArray(entries)) return { fixed: undefined, choices: undefined };
  for (const entry of entries) {
    if (typeof entry === 'string') fixed.push(referenceName(entry));
    if (!isRecord(entry)) continue;
    for (const [key, value] of Object.entries(entry)) if (value === true) fixed.push(key);
    if (isRecord(entry.choose) && Array.isArray(entry.choose.from)) {
      const from = entry.choose.from.filter(value => typeof value === 'string').map(referenceName);
      if (from.length) choices.push({ count: integer(entry.choose.count, 1, 1, 20), from });
    }
  }
  return { fixed: uniqueBy(fixed.filter(Boolean), value => value).slice(0, 100), choices: choices.slice(0, 20) };
}

function fixedProficiencies(entries) {
  if (!Array.isArray(entries)) return undefined;
  const values = [];
  for (const entry of entries) {
    if (typeof entry === 'string') values.push(referenceName(entry));
    if (!isRecord(entry)) continue;
    for (const [key, value] of Object.entries(entry)) if (value === true) values.push(key);
    if (isRecord(entry.choose)) {
      const count = integer(entry.choose.count, entry.choose.anyStandard || entry.choose.any || 1, 1, 20);
      values.push(`任选${count}项`);
    }
    if (Number.isFinite(entry.anyStandard)) values.push(`任选${integer(entry.anyStandard, 1, 1, 20)}项`);
  }
  return uniqueBy(values.filter(Boolean), value => value).slice(0, 100);
}

function featureSummaries(entries, source, prefix) {
  const named = collectNamedEntries(entries).slice(0, 80).map((entry, index) => ({
    id: `${prefix}:${entry.ENG_name || entry.name || index}`.slice(0, 180),
    name: firstText(entry.name, entry.ENG_name, `特性 ${index + 1}`).slice(0, 160),
    source: source.slice(0, 32),
    description: plainText(entry.entries ?? entry.entry).slice(0, 2400),
  }));
  if (named.length) return named;
  const description = plainText(entries).slice(0, 2400);
  return description ? [{ id: `${prefix}:summary`.slice(0, 180), name: '规则说明', source, description }] : undefined;
}

function spellProfile(entry) {
  return {
    school: firstText(entry.school).slice(0, 80),
    castingTime: plainText(Array.isArray(entry.time) ? entry.time[0] : entry.time).slice(0, 160),
    range: plainText(entry.range).slice(0, 160),
    duration: plainText(Array.isArray(entry.duration) ? entry.duration[0] : entry.duration).slice(0, 160),
    components: isRecord(entry.components) ? Object.keys(entry.components).filter(key => entry.components[key]).slice(0, 10) : [],
    concentration: Array.isArray(entry.duration) && entry.duration.some(value => isRecord(value) && value.concentration === true),
    ritual: Array.isArray(entry.meta) ? entry.meta.includes('ritual') : isRecord(entry.meta) && entry.meta.ritual === true,
    description: plainText(entry.entries).slice(0, 2400),
  };
}

function itemProfile(entry) {
  const type = firstText(entry.type, entry.weaponCategory, entry.rarity, 'equipment');
  const rawWeaponCategory = firstText(entry.weaponCategory);
  const weaponCategory = rawWeaponCategory === 'simple' ? '简易' : rawWeaponCategory === 'martial' ? '军用' : rawWeaponCategory;
  const properties = Array.isArray(entry.property) ? entry.property.filter(value => typeof value === 'string') : [];
  const armorBase = Number.isFinite(entry.ac) ? integer(entry.ac, 10, 0, 100) : null;
  const armorDexCap = type === 'MA' ? 2 : type === 'HA' ? 0 : armorBase === null ? null : null;
  const damageVersatile = firstText(entry.dmg2).slice(0, 80);
  return {
    category: type.slice(0, 80),
    weight: number(entry.weight, 0, 0, 100000),
    armorBase,
    armorDexCap,
    armorBonus: signedNumber(entry.bonusAc),
    damage: firstText(entry.dmg1).slice(0, 80),
    damageType: firstText(entry.dmgType).slice(0, 80),
    ...(damageVersatile ? { damageVersatile } : {}),
    ...(weaponCategory ? { weaponCategory } : {}),
    ...(properties.includes('F') ? { finesse: true } : {}),
    ...(properties.includes('L') ? { light: true } : {}),
    ...(properties.includes('2H') ? { twoHanded: true } : {}),
    ...(properties.includes('T') ? { thrown: true } : {}),
    ...(properties.includes('A') ? { ammunition: true } : {}),
    ...(properties.includes('R') ? { reach: true } : {}),
    ...(() => { const bonus = signedNumber(entry.bonusWeapon); return bonus ? { bonusWeapon: bonus } : {}; })(),
    range: firstText(entry.range).slice(0, 80),
    description: plainText(entry.entries).slice(0, 2400),
  };
}

function equipmentEntries(value) {
  const result = [];
  const visit = entry => {
    if (typeof entry === 'string') {
      const name = referenceName(entry);
      if (name) result.push({ name, quantity: quantityFromText(entry) });
      return;
    }
    if (!isRecord(entry)) return;
    if (typeof entry.item === 'string') result.push({ name: firstText(entry.displayName, referenceName(entry.item)), quantity: integer(entry.quantity, 1, 1, 100000) });
    else if (typeof entry.special === 'string') result.push({ name: entry.special.trim(), quantity: integer(entry.quantity, 1, 1, 100000) });
    else if (typeof entry.equipmentType === 'string') result.push({ name: `任选${equipmentTypeName(entry.equipmentType)}`, quantity: integer(entry.quantity, 1, 1, 100000) });
    const preferred = Array.isArray(entry._) ? entry._ : Array.isArray(entry.a) ? entry.a : null;
    if (preferred) preferred.forEach(visit);
  };
  if (isRecord(value) && Array.isArray(value.defaultData)) value.defaultData.forEach(visit);
  else if (Array.isArray(value)) value.forEach(visit);
  return uniqueEquipment(result).slice(0, 100);
}

function walkingSpeed(value) {
  if (Number.isFinite(value)) return integer(value, 30, 0, 500);
  if (isRecord(value) && Number.isFinite(value.walk)) return integer(value.walk, 30, 0, 500);
  return undefined;
}

function spellcastingAbility(entry) {
  if (isAbility(entry.spellcastingAbility)) return entry.spellcastingAbility;
  const name = firstText(entry.ENG_name, entry.name).toLocaleLowerCase();
  if (name.includes('wizard') || name.includes('artificer')) return 'int';
  if (name.includes('cleric') || name.includes('druid') || name.includes('ranger') || name.includes('monk')) return 'wis';
  if (name.includes('bard') || name.includes('paladin') || name.includes('sorcerer') || name.includes('warlock')) return 'cha';
  return undefined;
}

function identityMatches(value, ...candidates) {
  if (typeof value !== 'string' || !value.trim()) return true;
  const normalized = normalizeIdentity(value);
  return candidates.some(candidate => typeof candidate === 'string' && normalizeIdentity(candidate) === normalized);
}

function normalizeIdentity(value) {
  return value.trim().toLocaleLowerCase().replaceAll(/[^\p{L}\p{N}]/gu, '');
}

function collectNamedEntries(value, result = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectNamedEntries(entry, result);
    return result;
  }
  if (!isRecord(value)) return result;
  if (typeof value.name === 'string' || typeof value.ENG_name === 'string') result.push(value);
  for (const key of ['entries', 'items']) if (value[key] !== undefined) collectNamedEntries(value[key], result);
  return result;
}

function plainText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return cleanupRulesText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(plainText).filter(Boolean).join(' ');
  if (!isRecord(value)) return '';
  const named = firstText(value.name, value.ENG_name);
  const body = plainText(value.entry ?? value.entries ?? value.items ?? value.amount ?? value.number ?? value.type);
  return [named, body].filter(Boolean).join('：');
}

function cleanupRulesText(value) {
  return value
    .replaceAll(/\{@[^ ]+\s+([^}]+)\}/gu, (_, body) => {
      const parts = String(body).split('|');
      return parts.at(-1)?.trim() || parts[0]?.trim() || '';
    })
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

function referenceName(value) {
  if (typeof value !== 'string') return '';
  return cleanupRulesText(value.split('|')[0]).trim();
}

function quantityFromText(value) {
  const match = typeof value === 'string' ? value.match(/\((\d+)\)/u) : null;
  return match ? integer(Number(match[1]), 1, 1, 100000) : 1;
}

function equipmentTypeName(value) {
  return ({ weaponMartial: '军用武器', weaponSimple: '简易武器', armorLight: '轻甲', armorMedium: '中甲', armorHeavy: '重甲' })[value] || value;
}

function uniqueEquipment(entries) {
  const result = new Map();
  for (const entry of entries) {
    if (!entry.name) continue;
    const existing = result.get(entry.name);
    if (existing) existing.quantity += entry.quantity;
    else result.set(entry.name, { ...entry });
  }
  return [...result.values()];
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => {
    if (entry === undefined) return false;
    if (Array.isArray(entry)) return entry.length > 0;
    if (isRecord(entry)) return Object.keys(entry).length > 0;
    return true;
  }));
}

function isAbility(value) {
  return typeof value === 'string' && ABILITIES.includes(value);
}

function integer(value, fallback, minimum, maximum) {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.round(value))) : fallback;
}

function number(value, fallback, minimum, maximum) {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

function signedNumber(value) {
  if (Number.isFinite(value)) return integer(value, 0, -20, 20);
  if (typeof value !== 'string') return 0;
  const parsed = Number(value.replaceAll(/[^0-9+.-]/gu, ''));
  return Number.isFinite(parsed) ? integer(parsed, 0, -20, 20) : 0;
}

function spellClassNames(entry, name, nameEn, sourceLookup) {
  const classes = isRecord(entry.classes) ? entry.classes : {};
  const sourceRules = isRecord(sourceLookup[entry.source.toLocaleLowerCase()])
    ? sourceLookup[entry.source.toLocaleLowerCase()]
    : {};
  const translatedRules = sourceRules[name.toLocaleLowerCase()];
  const englishRules = sourceRules[nameEn.toLocaleLowerCase()];
  const spellRules = isRecord(translatedRules) ? translatedRules : isRecord(englishRules) ? englishRules : {};
  const lookupClasses = isRecord(spellRules.class) ? Object.values(spellRules.class) : [];
  const embeddedClassNames = [
    ...(Array.isArray(classes.fromClassList) ? classes.fromClassList : []),
    ...(Array.isArray(classes.fromClassListVariant) ? classes.fromClassListVariant : []),
  ].flatMap(value => isRecord(value) && typeof value.name === 'string' ? [value.name.trim()] : []);
  const lookupClassNames = lookupClasses.flatMap(value => isRecord(value) ? Object.keys(value) : []);
  return uniqueBy([...embeddedClassNames, ...lookupClassNames].filter(Boolean), value => value).slice(0, 30);
}

function readJsonOrEmpty(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isRecord(value) ? value : {};
  } catch { return {}; }
}

function firstText(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim() ?? '';
}

function jsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? jsonFiles(target) : entry.isFile() && entry.name.endsWith('.json') ? [target] : [];
  });
}

function uniqueBy(values, key) {
  const seen = new Set();
  return values.filter(value => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildCharacterRuleCatalog();
