import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { WATERDEEP_ENCOUNTERS, WATERDEEP_MONSTERS } from './waterdeep-encounters.mjs';
import { WATERDEEP_REMIX_ENCOUNTERS, waterdeepCityNpcPlacements } from './waterdeep-remix-encounters.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.resolve(process.env.MODULE_SOURCE_DIR ?? '');
const templateId = process.env.ROOM_TEMPLATE_ID?.trim() || 'waterdeep-dragon-heist';
const templateName = process.env.ROOM_TEMPLATE_NAME?.trim() || '深水城：龙金劫';
const templateDescription = process.env.ROOM_TEMPLATE_DESCRIPTION?.trim()
  || '从第一章到四季反派终章的完整跑团桌面，含章节地图、NPC 档案，以及按原文房间预置的非第四章遭遇。';
const templateVersion = positiveInteger(process.env.ROOM_TEMPLATE_VERSION, 4);
const mapSubdirectory = process.env.ROOM_TEMPLATE_MAP_SUBDIR?.trim() || path.join('地图', '按章节');
const npcSubdirectory = process.env.ROOM_TEMPLATE_NPC_SUBDIR?.trim() || 'NPC';
const includeEncounters = booleanSetting(process.env.ROOM_TEMPLATE_ENCOUNTERS, true);
const encounterMode = process.env.ROOM_TEMPLATE_ENCOUNTER_MODE?.trim() || 'original';
const stripSceneOrdering = booleanSetting(process.env.ROOM_TEMPLATE_STRIP_ORDERING, false);
const mapScaleMode = process.env.ROOM_TEMPLATE_MAP_SCALE_MODE?.trim() || 'fixed';
const baseManifestFile = process.env.ROOM_TEMPLATE_BASE_MANIFEST?.trim();
const outputRoot = path.join(ROOT, 'output', 'room-templates');
const templateRoot = path.join(outputRoot, templateId);
const assetRoot = path.join(templateRoot, 'assets');
const compendiumEntries = await loadCompendiumEntries(path.join(ROOT, 'data', 'db', 'index.json'));
const compendiumHitPoints = await loadCompendiumHitPoints(path.join(ROOT, 'data', 'db', 'bestiary'));

if (!process.env.MODULE_SOURCE_DIR) {
  throw new Error('请设置 MODULE_SOURCE_DIR 指向跑团模板素材目录');
}
if (!/^[a-z0-9][a-z0-9-]{0,79}$/u.test(templateId)) {
  throw new Error(`ROOM_TEMPLATE_ID 格式无效：${templateId}`);
}
if (!['fixed', 'auto'].includes(mapScaleMode)) {
  throw new Error(`ROOM_TEMPLATE_MAP_SCALE_MODE 只支持 fixed 或 auto：${mapScaleMode}`);
}
if (!['original', 'remix'].includes(encounterMode)) {
  throw new Error(`ROOM_TEMPLATE_ENCOUNTER_MODE 只支持 original 或 remix：${encounterMode}`);
}
const encounterCatalog = encounterMode === 'remix' ? WATERDEEP_REMIX_ENCOUNTERS : WATERDEEP_ENCOUNTERS;
const mapRoot = path.join(sourceRoot, mapSubdirectory);
const npcRoot = path.join(sourceRoot, npcSubdirectory);
await readdir(mapRoot);
await readdir(npcRoot);

await rm(templateRoot, { recursive: true, force: true });
await mkdir(assetRoot, { recursive: true });

const mapFiles = (await filesBelow(mapRoot, file => isSupportedMap(file)))
  .sort(chineseNaturalSort);
const scenes = [];
const mapNameBySceneKey = new Map();
for (const [index, source] of mapFiles.entries()) {
  const image = await readFile(source);
  const metadata = await sharp(image).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`无法读取地图尺寸：${source}`);
  // Content-addressed IDs make browser caches safe when a future template
  // version replaces a map while keeping the same chapter ordering.
  const digest = createHash('sha256').update(image).digest('hex').slice(0, 12);
  const assetId = `map-${String(index + 1).padStart(3, '0')}-${digest}`;
  await cp(source, path.join(assetRoot, assetId));
  const relative = path.relative(mapRoot, source);
  const rawChapterParts = path.dirname(relative).split(path.sep);
  const chapterParts = stripSceneOrdering ? rawChapterParts.map(stripOrderingPrefix) : rawChapterParts;
  const chapter = chapterParts.join(' / ');
  const rawMapName = path.basename(source, path.extname(source));
  const mapName = stripSceneOrdering ? stripOrderingPrefix(rawMapName) : rawMapName;
  const key = `scene-${String(index + 1).padStart(3, '0')}`;
  mapNameBySceneKey.set(key, rawMapName);
  scenes.push({
    key,
    name: `${chapter} · ${mapName}`,
    chapter,
    map: {
      assetId,
      width: metadata.width,
      height: metadata.height,
      contentType: imageContentType(source),
      mapScale: mapScaleFor(metadata),
    },
    unlocked: index === 0,
  });
}

const npcFiles = (await filesBelow(npcRoot, file => file.toLowerCase().endsWith('.md')))
  .filter(file => !path.basename(file).startsWith('00-') && path.basename(file).toLocaleLowerCase() !== 'readme.md')
  .sort(chineseNaturalSort);
const npcs = [];
for (const source of npcFiles) {
  const relative = path.relative(npcRoot, source).split(path.sep).join('/');
  const markdown = (await readFile(source, 'utf8')).replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  const heading = /^#\s+(.+?)\s*$/mu.exec(markdown)?.[1]?.replace(/\s+#+\s*$/u, '').trim()
    ?? path.basename(source, path.extname(source)).replace(/^\d+-/u, '');
  const sourceBody = markdown
    .replace(/^#\s+.*?(?:\n|$)/u, '')
    .replace(/^!\[[^\n]*\]\([^\n]+\)\s*$/gmu, '')
    .trim();
  const directoryPath = path.dirname(relative) === '.'
    ? []
    : path.dirname(relative).split('/').map(stripOrderingPrefix).filter(Boolean);
  const faction = (directoryPath[0] || labeledField(sourceBody, '阵营') || '未分类').slice(0, 120);
  const sections = individualNpcSections(sourceBody);
  const records = sections.length >= 2
    ? sections.map(section => ({
      heading: section.heading,
      notesMarkdown: section.body,
      sourceFile: `${relative}#${section.heading}`,
      groupPath: [...directoryPath, heading],
    }))
    : [{ heading, notesMarkdown: sourceBody, sourceFile: relative, groupPath: directoryPath }];

  for (const record of records) {
    const notesMarkdown = record.notesMarkdown.trim().slice(0, 16_000);
    const role = npcRoleFromMarkdown(notesMarkdown, faction);
    const location = npcLocationFromMarkdown(notesMarkdown);
    const identities = splitNpcHeading(record.heading);
    for (const identity of identities) {
      const sourceFile = sections.length >= 2 || identities.length > 1 ? `${relative}#${identity.name}` : record.sourceFile;
      npcs.push({
        id: `npc-${createHash('sha256').update(sourceFile).digest('hex').slice(0, 20)}`,
        name: identity.name,
        aliases: identity.aliases,
        role,
        location,
        status: npcStatusFromMarkdown(notesMarkdown),
        importance: npcImportanceFromMarkdown(notesMarkdown, role, identity.name),
        faction,
        groupPath: [faction],
        statReference: npcStatReference(notesMarkdown, role, identity),
        notesMarkdown,
        sourceFile: sourceFile.slice(0, 180),
        updatedAt: 0,
      });
    }
  }
}

let baseNpcMatchCount = 0;
if (baseManifestFile) baseNpcMatchCount = await mergeBaseNpcRecords(npcs, path.resolve(baseManifestFile));
if (includeEncounters) ensureEncounterNpcs(npcs, encounterCatalog);
deduplicateNpcs(npcs);
for (const npc of npcs) npc.notesMarkdown = npcPresentationNotes(npc);
sortNpcsByImportance(npcs);
let encounterTokenCount = 0;
let encounterRoomCount = 0;
for (const scene of scenes) {
  const mapName = mapNameBySceneKey.get(scene.key);
  const placements = includeEncounters
    ? [
      ...(encounterCatalog[mapName] ?? []),
      ...(encounterMode === 'remix' && mapName === '01-深水城城区总览' ? waterdeepCityNpcPlacements(npcs) : []),
    ]
    : [];
  scene.tokens = encounterTokens(scene, placements, npcs);
  encounterTokenCount += scene.tokens.length;
  encounterRoomCount += placements.length;
}

const summary = {
  id: templateId,
  name: templateName,
  description: templateDescription,
  version: templateVersion,
  sceneCount: scenes.length,
  npcCount: npcs.length,
};
const manifest = { schemaVersion: 1, ...summary, scenes, npcs };
await writeFile(path.join(templateRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
const existingTemplates = await existingTemplateSummaries(path.join(outputRoot, 'index.json'));
const templates = [...existingTemplates.filter(template => template.id !== templateId), summary]
  .sort((left, right) => chineseNaturalSort(left.name, right.name));
await writeFile(path.join(outputRoot, 'index.json'), `${JSON.stringify({ schemaVersion: 1, templates }, null, 2)}\n`, 'utf8');

console.log(`[room-template] 已生成 ${summary.name}：${scenes.length} 个场景，${npcs.length} 个 NPC`);
if (baseManifestFile) console.log(`[room-template] 已关联原版角色资料：${baseNpcMatchCount}/${npcs.length} 个 NPC`);
if (includeEncounters) {
  const sourceLabel = encounterMode === 'remix' ? '重置版文本与敌人分组名册' : '原文';
  console.log(`[room-template] 已按${sourceLabel}预置 ${encounterRoomCount} 个地点、${encounterTokenCount} 个 Token`);
} else {
  console.log('[room-template] 场景保持空地图；NPC 已归档到阵营资料库，可按需加入地图');
}
console.log(`[room-template] 输出目录：${templateRoot}`);

async function filesBelow(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesBelow(target, predicate);
    return entry.isFile() && predicate(target) ? [target] : [];
  }));
  return nested.flat();
}

function chineseNaturalSort(left, right) {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

function positiveInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`模板版本必须是正整数：${value}`);
  return parsed;
}

function booleanSetting(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (/^(?:1|true|yes|on)$/iu.test(value)) return true;
  if (/^(?:0|false|no|off)$/iu.test(value)) return false;
  throw new Error(`布尔配置无效：${value}`);
}

function isSupportedMap(file) {
  return /\.(?:jpe?g|png|webp)$/iu.test(file);
}

function imageContentType(file) {
  const extension = path.extname(file).toLocaleLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function mapScaleFor(metadata) {
  if (mapScaleMode === 'auto' && Math.max(metadata.width ?? 0, metadata.height ?? 0) > 3000) return 1;
  // Most extracted book maps use roughly 32 px squares. Scaling them to about
  // 100 px squares matches the application's shared Token footprint.
  return 3;
}

async function existingTemplateSummaries(indexFile) {
  try {
    const value = JSON.parse(await readFile(indexFile, 'utf8'));
    return value?.schemaVersion === 1 && Array.isArray(value.templates)
      ? value.templates.filter(template => template && typeof template.id === 'string' && typeof template.name === 'string')
      : [];
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return [];
    throw error;
  }
}

function stripOrderingPrefix(value) {
  return value.trim().replace(/^\d+[\s._-]*/u, '').trim();
}

function labeledField(markdown, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`^\\s*(?:[-*+]\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*[:：]\\s*(.*?)\\s*$`, 'imu').exec(markdown);
  return match?.[1]?.replace(/\*\*\s*$/u, '').trim() ?? '';
}

function individualNpcSections(markdown) {
  const headings = [...markdown.matchAll(/^##\s+(.+?)\s*$/gmu)];
  return headings.flatMap((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = headings[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(start, end).trim();
    return labeledField(body, '身份')
      ? [{ heading: match[1].replace(/\s+#+\s*$/u, '').trim(), body }]
      : [];
  });
}

function splitNpcHeading(heading) {
  const parts = heading.split(/\s*(?:与|、)\s*/u).map(value => value.trim()).filter(Boolean);
  return (parts.length > 1 ? parts : [heading.trim()]).map(value => {
    const split = /^(.*?[\p{Script=Han}）)])\s+([A-Z][A-Za-z0-9 .,'’"()\-/]+)$/u.exec(value);
    return { name: (split?.[1] ?? value).trim().slice(0, 120), aliases: split?.[2] ? [split[2].trim().slice(0, 80)] : [] };
  });
}

function npcStatusFromMarkdown(markdown) {
  const status = labeledField(markdown, '状态').toLocaleLowerCase();
  if (/dead|deceased|死亡|已死|阵亡/u.test(status)) return 'dead';
  if (/missing|失踪|下落不明/u.test(status)) return 'missing';
  if (/inactive|retired|离开|退场|非活跃/u.test(status)) return 'inactive';
  return 'active';
}

function npcImportanceFromMarkdown(markdown, role, name = '') {
  const explicit = labeledField(markdown, '重要程度').trim().toLocaleLowerCase();
  if (/^(?:major|main|primary|主要|核心|主角|关键)$/u.test(explicit)) return 'major';
  if (/^(?:minor|background|次要|普通|背景)$/u.test(explicit)) return 'minor';
  if (/^(?:supporting|secondary|重要|配角|重要配角)$/u.test(explicit)) return 'supporting';
  const searchable = `${name}\n${role}`;
  if (/首领|创始人|领主|掌权|统治者|最终反派|主要反派|核心人物|关键人物|大法师|公开领主|黑杖|公会之主/u.test(searchable)) return 'major';
  if (/普通成员|普通人|平民|仆人|侍从|守卫|卫兵|士兵|学徒|宠物|囚徒|俘虏|信使|跟班|雇员|次要人物/u.test(searchable)) return 'minor';
  return 'supporting';
}

function npcProfiles() { return [
  ['MM__Adult Gold Dragon', '成年金龙', 'Adult Gold Dragon', ['adult gold dragon', '成年金龙']],
  ['MM__Drow Elite Warrior', '卓尔精英武者', 'Drow Elite Warrior', ['drow elite warrior', '卓尔精英武者']],
  ['WDH__Drow Gunslinger', '卓尔火枪手', 'Drow Gunslinger', ['drow gunslinger', '卓尔火枪手']],
  ['VGM__Swashbuckler', '游荡剑者', 'Swashbuckler', ['swashbuckler', '游荡剑者', '剑客']],
  ['VGM__Martial Arts Adept', '武术高手', 'Martial Arts Adept', ['martial arts adept', '武术高手']],
  ['VGM__Apprentice Wizard', '学徒法师', 'Apprentice Wizard', ['apprentice wizard', '学徒法师', '学徒']],
  ['WDH__Nimblewright', '灵巧莱特', 'Nimblewright', ['nimblewright', '灵巧莱特', '秘偶']],
  ['MM__Bandit Captain', '强盗首领', 'Bandit Captain', ['bandit captain', '强盗首领', '匪帮队长']],
  ['MM__Mind Flayer', '夺心魔', 'Mind Flayer', ['mind flayer', '夺心魔', '灵吸怪']],
  ['MM__Drow Mage', '卓尔法师', 'Drow Mage', ['drow mage', '卓尔法师']],
  ['MM__Chain Devil', '链魔', 'Chain Devil', ['chain devil', '链魔']],
  ['MM__Beholder', '眼魔', 'Beholder', ['beholder', '眼魔']],
  ['MM__Duergar', '灰矮人', 'Duergar', ['duergar', '灰矮人']],
  ['MM__Goblin', '地精', 'Goblin', ['goblin', '地精']],
  ['MM__Drow', '卓尔', 'Drow', ['drow', '卓尔']],
  ['MM__Quipper', '食人鱼', 'Quipper', ['quipper', '宠物鱼', '鱼']],
  ['MM__Draft Horse', '驮马', 'Draft Horse', ['draft horse', '驮用母马', '驮马']],
  ['MM__Cat', '猫', 'Cat', ['cat', '猫']],
  ['MM__Archmage', '大法师', 'Archmage', ['archmage', '大法师']],
  ['MM__Assassin', '刺客', 'Assassin', ['assassin', '刺客']],
  ['MM__Veteran', '老兵', 'Veteran', ['veteran', 'veterans', '老兵']],
  ['MM__Commoner', '平民', 'Commoner', ['commoner', '平民']],
  ['MM__Noble', '贵族', 'Noble', ['noble', '贵族']],
  ['MM__Cultist', '邪教徒', 'Cultist', ['cultist', '邪教徒']],
  ['MM__Gladiator', '角斗士', 'Gladiator', ['gladiator', '角斗士']],
  ['MM__Berserker', '狂战士', 'Berserker', ['berserker', '狂战士']],
  ['MM__Priest', '祭司', 'Priest', ['priest', '祭司']],
  ['MM__Knight', '骑士', 'Knight', ['knight', 'knights', '骑士']],
  ['MM__Thug', '暴徒', 'Thug', ['thug', '暴徒', '佣兵']],
  ['MM__Guard', '警卫', 'Guard', ['guard', 'guards', '警卫', '守卫']],
  ['MM__Mage', '魔法师', 'Mage', ['mage', '魔法师', '法师']],
  ['MM__Druid', '德鲁伊', 'Druid', ['druid', '德鲁伊']],
  ['MM__Spy', '间谍', 'Spy', ['spy', '间谍', '密探']],
  ['MM__Scout', '斥候', 'Scout', ['scout', '斥候', '侦察兵']],
  ['MM__Bandit', '匪徒', 'Bandit', ['bandit', '强盗', '匪徒', '马贼']],
  ['MM__Ghost', '幽灵', 'Ghost', ['ghost', '幽灵', '幽魂']],
  ['MM__Cult Fanatic', '邪教狂信者', 'Cult Fanatic', ['cult fanatic', '邪教狂信者']],
  ['VGM__Bard', '吟游诗人', 'Bard', ['bard', '吟游诗人']],
  ['WDH__Griffon Cavalry Rider', '狮鹫骑兵骑手', 'Griffon Cavalry Rider', ['griffon cavalry rider', '狮鹫骑兵骑手']],
]; }

function npcStatReference(markdown, role, identity) {
  if (/\|\s*护甲等级\s*\|/u.test(markdown) && /\|\s*生命值\s*\|/u.test(markdown)) return { kind: 'custom' };
  const exact = compendiumEntryForIdentity(identity);
  if (exact) return { kind: 'compendium', entryId: exact.id, nameZh: exact.nameZh, nameEn: exact.nameEn };
  const searchable = [
    markdownSection(markdown, ['身份 / 数据', '身份／数据']),
    labeledField(markdown, '身份'),
    labeledField(markdown, '游戏数据'),
    labeledField(markdown, '描述'),
    markdownBeforeDescription(markdown),
    role,
  ].filter(Boolean).join('\n').toLocaleLowerCase();
  const profiles = npcProfiles();
  const selected = bestNpcProfileMatch(searchable, profiles)
    ?? profiles.find(([entryId]) => entryId === 'MM__Commoner');
  return { kind: 'compendium', entryId: selected[0], nameZh: selected[1], nameEn: selected[2] };
}

async function loadCompendiumEntries(indexFile) {
  const source = JSON.parse(await readFile(indexFile, 'utf8'));
  if (!Array.isArray(source)) throw new Error(`规则资料索引无效：${indexFile}`);
  return source.filter(entry => entry?.type === 'monster'
    && typeof entry.id === 'string'
    && typeof entry.nameZh === 'string'
    && typeof entry.nameEn === 'string');
}

function compendiumEntryForIdentity(identity) {
  const candidates = [identity.name, ...identity.aliases]
    .flatMap(value => value.split(/\s*[／/]\s*/u))
    .map(normalizedCompendiumName)
    .filter(value => value.length >= 3);
  return compendiumEntries.find(entry => {
    const names = [entry.nameZh, entry.nameEn].map(normalizedCompendiumName);
    return candidates.some(candidate => names.includes(candidate));
  }) ?? null;
}

function normalizedCompendiumName(value) {
  return value.normalize('NFKC').replace(/[^\p{Letter}\p{Number}]+/gu, '').toLocaleLowerCase();
}

function markdownBeforeDescription(markdown) {
  const marker = /^\s*(?:[-*+]\s*)?(?:\*\*)?描述(?:\*\*)?\s*[:：]/imu.exec(markdown);
  return marker ? markdown.slice(0, marker.index) : '';
}

function bestNpcProfileMatch(searchable, profiles) {
  let best = null;
  for (const profile of profiles) {
    for (const alias of profile[3]) {
      const normalizedAlias = alias.toLocaleLowerCase();
      const index = searchable.indexOf(normalizedAlias);
      if (index < 0) continue;
      if (!best || index < best.index || (index === best.index && normalizedAlias.length > best.aliasLength)) {
        best = { profile, index, aliasLength: normalizedAlias.length };
      }
    }
  }
  return best?.profile ?? null;
}

function npcRoleFromMarkdown(markdown, faction) {
  const identity = labeledField(markdown, '身份')
    || markdownSection(markdown, ['身份 / 数据', '身份／数据'])
    || labeledField(markdown, '游戏数据')
    || identityParagraphBeforeDescription(markdown)
    || labeledField(markdown, '描述')
    || firstNarrativeParagraph(markdown);
  return plainExcerpt(identity, 120) || `${faction}相关人物`.slice(0, 120);
}

function npcLocationFromMarkdown(markdown) {
  const location = labeledField(markdown, '地点')
    || labeledField(markdown, '出场地点')
    || firstParagraph(markdownSection(markdown, ['出场地点']))
    || labeledField(markdown, '出处');
  return plainExcerpt(location, 120);
}

function identityParagraphBeforeDescription(markdown) {
  const prefix = markdownBeforeDescription(markdown);
  if (!prefix) return '';
  const paragraphs = prefix.split(/\n\s*\n/gu).map(value => value.trim()).filter(Boolean);
  return paragraphs.find(value => !/^(?:#|\||!\[|>)/u.test(value)
    && !/^\*\*(?:中型|小型|大型|超大型|巨型|微型)/u.test(value)) ?? '';
}

function firstParagraph(markdown) {
  return markdown.split(/\n\s*\n/gu).map(value => value.trim()).find(Boolean) ?? '';
}

function npcBackgroundFromMarkdown(markdown) {
  const background = labeledField(markdown, '描述')
    || markdownSection(markdown, ['重置版职责', '人物背景', '背景'])
    || firstNarrativeParagraph(markdown);
  return plainExcerpt(background, 240);
}

function markdownSection(markdown, headings) {
  const wanted = new Set(headings.map(heading => heading.replace(/\s+/gu, '').toLocaleLowerCase()));
  const matches = [...markdown.matchAll(/^##\s+(.+?)\s*$/gmu)];
  for (const [index, match] of matches.entries()) {
    const heading = match[1].replace(/\s+#+\s*$/u, '').replace(/\s+/gu, '').toLocaleLowerCase();
    if (!wanted.has(heading)) continue;
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? markdown.length;
    return markdown.slice(start, end).trim();
  }
  return '';
}

function firstNarrativeParagraph(markdown) {
  const paragraphs = markdown.split(/\n\s*\n/gu).map(value => value.trim()).filter(Boolean);
  return paragraphs.find(value => !/^(?:#|\||!\[|>|[-*+]\s+\*\*)/u.test(value)
    && !/^\*\*(?:中型|小型|大型|超大型|巨型|微型)/u.test(value)) ?? '';
}

function plainExcerpt(markdown, maximum) {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/^#+\s*/gmu, '')
    .replace(/^>\s*/gmu, '')
    .replace(/\*\*|__|`/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function npcPresentationNotes(npc) {
  const bodyMarker = /^##\s+背景与规则资料\s*$/mu.exec(npc.notesMarkdown);
  const body = bodyMarker
    ? npc.notesMarkdown.slice((bodyMarker.index ?? 0) + bodyMarker[0].length).trim()
    : npc.notesMarkdown.trim();
  const statLabel = npc.statReference?.kind === 'compendium'
    ? `${npc.statReference.nameZh}（${npc.statReference.nameEn}）`
    : '专属角色数据';
  const background = npcBackgroundFromMarkdown(npc.notesMarkdown);
  const fields = [
    `- **身份**：${npc.role}`,
    `- **阵营/归属**：${npc.faction}`,
    `- **重要程度**：${npc.importance === 'major' ? '主要人物' : npc.importance === 'minor' ? '次要人物' : '重要配角'}`,
    ...(npc.location ? [`- **出场地点**：${npc.location}`] : []),
    `- **状态**：${npc.status === 'dead' ? '死亡' : npc.status === 'missing' ? '失踪' : npc.status === 'inactive' ? '退场' : '活跃'}`,
    ...(npc.aliases.length > 0 ? [`- **别名**：${npc.aliases.join('、')}`] : []),
    `- **规则数据**：${statLabel}`,
    ...(background ? [`- **背景摘要**：${background}`] : []),
  ];
  const prefix = `## 人物档案\n\n${fields.join('\n')}\n\n## 背景与规则资料\n\n`;
  return `${prefix}${body || '暂无补充资料。'}`.slice(0, 16_000);
}

async function mergeBaseNpcRecords(npcs, manifestFile) {
  const source = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (!Array.isArray(source?.npcs)) throw new Error(`原版模板 NPC 数据无效：${manifestFile}`);
  const byIdentity = new Map();
  for (const npc of source.npcs) {
    for (const value of [npc?.name, ...(Array.isArray(npc?.aliases) ? npc.aliases : [])]) {
      if (typeof value === 'string') byIdentity.set(normalizedNpcName(value), npc);
    }
  }
  let matches = 0;
  for (const npc of npcs) {
    const base = [npc.name, ...npc.aliases].map(normalizedNpcName).map(value => byIdentity.get(value)).find(Boolean);
    if (!base) continue;
    matches += 1;
    npc.aliases = [...new Set([...npc.aliases, ...(Array.isArray(base.aliases) ? base.aliases : [])])].slice(0, 12);
    if (!npc.role && typeof base.role === 'string') npc.role = base.role.slice(0, 120);
    if (!npc.location && typeof base.location === 'string') npc.location = base.location.slice(0, 120);
    if (!npc.importance && ['major', 'supporting', 'minor'].includes(base.importance)) npc.importance = base.importance;
    const baseReference = base.statReference;
    const targetIsDefault = npc.statReference?.kind === 'compendium' && npc.statReference.entryId === 'MM__Commoner';
    const baseIsSpecific = baseReference?.kind !== 'compendium' || baseReference.entryId !== 'MM__Commoner';
    if (targetIsDefault && baseReference && baseIsSpecific) npc.statReference = { ...baseReference };
    const targetBackground = npcBackgroundFromMarkdown(npc.notesMarkdown);
    const baseBackground = typeof base.notesMarkdown === 'string' ? npcBackgroundFromMarkdown(base.notesMarkdown) : '';
    if (!targetBackground && baseBackground) {
      npc.notesMarkdown = `${npc.notesMarkdown}\n\n## 原版人物背景\n\n${baseBackground}`.trim().slice(0, 16_000);
    }
  }
  return matches;
}

function ensureEncounterNpcs(npcs, encounterCatalog) {
  for (const placements of Object.values(encounterCatalog)) {
    for (const placement of placements) {
      for (const occupant of placement.occupants) {
        if (occupant.kind !== 'npc' || findEncounterNpc(npcs, occupant.name)) continue;
        const profile = compendiumProfile(occupant.statEntryId);
        const id = `npc-${createHash('sha256').update(`encounter:${occupant.name}`).digest('hex').slice(0, 20)}`;
        npcs.push({
          id,
          name: occupant.name,
          aliases: [],
          role: '原文场景角色',
          location: placement.label,
          status: 'active',
          importance: 'minor',
          faction: '模组遭遇补录',
          groupPath: ['模组遭遇补录'],
          statReference: { kind: 'compendium', entryId: profile.entryId, nameZh: profile.nameZh, nameEn: profile.nameEn },
          notesMarkdown: `**身份**：原文场景角色\n\n**地点**：${placement.label}\n\n由跑团模板根据《深水城：龙金劫》原文补录。`,
          sourceFile: `文案/全文.txt#${placement.label}`,
          updatedAt: 0,
        });
      }
    }
  }
}

function sortNpcsByImportance(npcs) {
  const importanceRank = { major: 0, supporting: 1, minor: 2 };
  npcs.sort((left, right) => (importanceRank[left.importance] ?? 1) - (importanceRank[right.importance] ?? 1)
    || chineseNaturalSort(left.faction, right.faction)
    || chineseNaturalSort(left.name, right.name));
}

function deduplicateNpcs(npcs) {
  const groups = new Map();
  for (const npc of npcs) {
    const key = `${normalizedNpcName(npc.faction)}\0${normalizedNpcName(npc.name)}`;
    const group = groups.get(key) ?? [];
    group.push(npc);
    groups.set(key, group);
  }
  const importanceRank = { major: 0, supporting: 1, minor: 2 };
  const merged = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort((left, right) => npcBuildQuality(right) - npcBuildQuality(left));
    const primary = ordered[0];
    primary.aliases = [...new Set(ordered.flatMap(npc => npc.aliases ?? []))].slice(0, 12);
    primary.role = ordered.map(npc => npc.role ?? '').filter(Boolean).sort((left, right) => right.length - left.length)[0] ?? '';
    primary.location = ordered.map(npc => npc.location ?? '').find(Boolean) ?? '';
    primary.importance = ordered.map(npc => npc.importance ?? 'supporting')
      .sort((left, right) => (importanceRank[left] ?? 1) - (importanceRank[right] ?? 1))[0];
    const notes = [];
    const noteKeys = new Set();
    for (const npc of ordered) {
      const bodyMarker = /^##\s+背景与规则资料\s*$/mu.exec(npc.notesMarkdown);
      const body = (bodyMarker ? npc.notesMarkdown.slice((bodyMarker.index ?? 0) + bodyMarker[0].length) : npc.notesMarkdown).trim();
      const key = body.replace(/\s+/gu, ' ').toLocaleLowerCase();
      if (!key || noteKeys.has(key)) continue;
      noteKeys.add(key);
      notes.push(body);
    }
    primary.notesMarkdown = notes.join('\n\n## 补充资料\n\n').slice(0, 16_000);
    const specificReference = ordered.map(npc => npc.statReference).find(reference => reference?.kind === 'custom'
      || reference?.kind === 'npc'
      || (reference?.kind === 'compendium' && reference.entryId !== 'MM__Commoner'));
    if (specificReference) primary.statReference = { ...specificReference };
    primary.groupPath = [primary.faction];
    merged.push(primary);
  }
  npcs.splice(0, npcs.length, ...merged);
}

function npcBuildQuality(npc) {
  let score = npc.statReference?.kind === 'custom' ? 50 : 0;
  if (npc.statReference?.kind === 'npc' || (npc.statReference?.kind === 'compendium' && npc.statReference.entryId !== 'MM__Commoner')) score += 25;
  if (npc.role) score += 5;
  if (npc.location) score += 3;
  return score + Math.min(20, Math.floor((npc.notesMarkdown?.length ?? 0) / 500));
}

function encounterTokens(scene, placements, npcs) {
  const tokens = [];
  const serials = new Map();
  for (const placement of placements) {
    const occupants = placement.occupants.flatMap(occupant => Array.from({ length: occupant.count }, () => occupant));
    const columns = placement.columns ?? Math.max(1, Math.ceil(Math.sqrt(occupants.length)));
    const rows = Math.ceil(occupants.length / columns);
    const spacing = placement.spacing ?? 34;
    occupants.forEach((occupant, index) => {
      const column = index % columns;
      const rowIndex = Math.floor(index / columns);
      const sourceX = placement.anchor[0] + (column - (Math.min(columns, occupants.length) - 1) / 2) * spacing;
      const sourceY = placement.anchor[1] + (rowIndex - (rows - 1) / 2) * spacing;
      const token = occupant.kind === 'monster'
        ? monsterToken(occupant.key)
        : npcToken(occupant.name, npcs, occupant.npcId);
      const serialKey = `${token.kind}:${token.entryId}`;
      const number = (serials.get(serialKey) ?? 0) + 1;
      serials.set(serialKey, number);
      const size = 100;
      const maximumX = scene.map.width * scene.map.mapScale - size;
      const maximumY = scene.map.height * scene.map.mapScale - size;
      token.key = `token-${createHash('sha256').update(`${scene.key}:${placement.label}:${serialKey}:${number}`).digest('hex').slice(0, 20)}`;
      token.room = placement.label;
      token.x = clamp(Math.round(sourceX * scene.map.mapScale - size / 2), 0, maximumX);
      token.y = clamp(Math.round(sourceY * scene.map.mapScale - size / 2), 0, maximumY);
      token.size = size;
      token.number = number;
      tokens.push(token);
    });
  }
  return tokens;
}

function monsterToken(key) {
  const profile = WATERDEEP_MONSTERS[key];
  if (!profile) throw new Error(`未知的龙金劫怪物资料：${key}`);
  const [entryId, nameZh, , hitPoints] = profile;
  return {
    kind: 'monster',
    name: nameZh,
    entryId,
    avatar: `/api/token/${encodeURIComponent(entryId)}`,
    color: '#f97316',
    hp: { current: hitPoints, max: hitPoints },
  };
}

function npcToken(name, npcs, npcId) {
  const npc = npcId ? npcs.find(candidate => candidate.id === npcId) : findEncounterNpc(npcs, name);
  if (!npc) throw new Error(`无法解析龙金劫 NPC：${name}`);
  const statEntryId = npc.statReference?.kind === 'compendium' ? npc.statReference.entryId : null;
  // Named Dragon Heist characters often carry a richer custom stat block in
  // the campaign archive while the compendium still has the official portrait.
  // Keep the custom rules data, but fall back to that same-name portrait.
  const avatarEntryId = statEntryId
    ?? compendiumEntryForIdentity({ name: npc.name, aliases: npc.aliases })?.id
    ?? npcAvatarOverride(npc.name);
  const hitPoints = npcHitPoints(npc, statEntryId);
  return {
    kind: 'npc',
    name: npc.name,
    entryId: `npc:${npc.id}`,
    avatar: avatarEntryId ? `/api/token/${encodeURIComponent(avatarEntryId)}` : '',
    color: '#8b5cf6',
    ...(hitPoints ? { hp: { current: hitPoints, max: hitPoints } } : {}),
  };
}

function findEncounterNpc(npcs, wantedName) {
  const wanted = normalizedNpcName(wantedName);
  return npcs.find(npc => normalizedNpcName(npc.name) === wanted
    || npc.aliases.some(alias => normalizedNpcName(alias) === wanted));
}

function normalizedNpcName(value) {
  return value.normalize('NFKC')
    .replace(/[「」“”"'’·\s（）()／/：:.-]/gu, '')
    .replace(/[A-Za-z][A-Za-z0-9,'\s.-]*$/u, '')
    .toLocaleLowerCase();
}

function compendiumProfile(entryId) {
  const monster = Object.values(WATERDEEP_MONSTERS).find(([candidate]) => candidate === entryId);
  if (monster) return { entryId: monster[0], nameZh: monster[1], nameEn: monster[2] };
  const known = npcProfiles().find(([candidate]) => candidate === entryId);
  if (known) return { entryId: known[0], nameZh: known[1], nameEn: known[2] };
  const nameEn = entryId.split('__', 2)[1] || 'Commoner';
  return { entryId, nameZh: nameEn, nameEn };
}

function npcHitPoints(npc, statEntryId) {
  const explicit = /(?:\|\s*生命值\s*\||\*\*生命值\*\*\s*[:：]|\bHP\s*[:：])\s*\**(\d+)/iu.exec(npc.notesMarkdown)?.[1];
  if (explicit) return Number.parseInt(explicit, 10);
  if (!statEntryId) return null;
  const indexed = compendiumEntries.find(entry => entry.id === statEntryId)?.hitPoints;
  if (Number.isFinite(indexed) && indexed > 0) return indexed;
  const resolved = compendiumHitPoints.get(statEntryId);
  if (resolved) return resolved;
  const monster = Object.values(WATERDEEP_MONSTERS).find(([candidate]) => candidate === statEntryId);
  if (monster) return monster[3];
  return npcProfileHitPoints(statEntryId);
}

function npcAvatarOverride(name) {
  return ({
    深水城自走巨像: 'WDH__Walking Statue of Waterdeep',
    '瓦罗赞普「瓦罗」格达姆': 'VGM__Bard',
    黑蝰蛇: 'WDH__Black Viper',
  })[name] ?? null;
}

async function loadCompendiumHitPoints(directory) {
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'));
  const records = new Map();
  for (const file of files) {
    const source = JSON.parse(await readFile(path.join(directory, file.name), 'utf8'));
    for (const creature of Array.isArray(source?.monster) ? source.monster : []) {
      if (typeof creature?.source !== 'string' || typeof creature?.ENG_name !== 'string') continue;
      records.set(`${creature.source}__${creature.ENG_name}`, creature);
    }
  }
  const resolved = new Map();
  const resolving = new Set();
  const resolve = (entryId) => {
    if (resolved.has(entryId)) return resolved.get(entryId);
    if (resolving.has(entryId)) return null;
    const creature = records.get(entryId);
    if (!creature) return null;
    resolving.add(entryId);
    const direct = Number.isFinite(creature.hp?.average) && creature.hp.average > 0 ? creature.hp.average : null;
    const copied = !direct && typeof creature._copy?.source === 'string' && typeof creature._copy?.ENG_name === 'string'
      ? resolve(`${creature._copy.source}__${creature._copy.ENG_name}`)
      : null;
    resolving.delete(entryId);
    const value = direct ?? copied;
    if (value) resolved.set(entryId, value);
    return value;
  };
  for (const entryId of records.keys()) resolve(entryId);
  return resolved;
}

function npcProfileHitPoints(entryId) {
  return ({
  MM__Commoner: 4,
  MM__Noble: 9,
  MM__Guard: 11,
  MM__Bandit: 11,
  MM__Goblin: 7,
  MM__Duergar: 26,
  MM__Veteran: 58,
  MM__Priest: 27,
  MM__Druid: 27,
  MM__Mage: 40,
  MM__Archmage: 99,
  MM__Assassin: 78,
  MM__Spy: 27,
  MM__Cult_Fanatic: 33,
  'MM__Cult Fanatic': 33,
  'MM__Bandit Captain': 65,
  MM__Rakshasa: 110,
  MM__Doppelganger: 52,
  MM__Beholder: 180,
  MM__Quipper: 1,
  'MM__Half-Ogre (Ogrillon)': 30,
  MM__Minotaur: 76,
  MM__Orog: 42,
  MM__Drow: 13,
  'MM__Drow Mage': 45,
  'MM__Drow Elite Warrior': 71,
  'MM__Mind Flayer': 71,
  'MM__Chain Devil': 85,
  MM__Ghost: 45,
  MM__Gargoyle: 52,
  MPMM__Apprentice_Wizard: 13,
  MPMM__ApprenticeWizard: 13,
  MPMM__Apprentice: 13,
  'MPMM__Apprentice Wizard': 13,
  WDH__Nimblewright: 45,
  'WDH__Drow Gunslinger': 84,
    'VGM__Martial Arts Adept': 60,
    'VGM__Apprentice Wizard': 9,
    VGM__Swashbuckler: 66,
  })[entryId] ?? null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
