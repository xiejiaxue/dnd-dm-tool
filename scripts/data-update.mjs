// scripts/data-update.mjs — download 5etools-cn data into data/db and build the search index
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnvHttpProxyAgent, fetch as proxyAwareFetch } from 'undici';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(ROOT, 'data', 'db');
// DND5E 不全书 supplies the localized fields; upstream 5etools fills schema
// fields and entries which have not been translated yet. A translated record
// always wins on overlapping fields.
const DND5E_CN_BASE = 'https://raw.githubusercontent.com/tjliqy/5etools-cn/cn2.0/data';
const FIVETOOLS_BASE = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data';
const UA = { 'User-Agent': 'Mozilla/5.0 (dnd-dm-tool)' };

const networkDispatcher = new EnvHttpProxyAgent();

async function fetchBytes(url) {
  const response = await proxyAwareFetch(url, {
    headers: UA,
    redirect: 'follow',
    dispatcher: networkDispatcher,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchJson(url) {
  return JSON.parse((await fetchBytes(url)).toString('utf8'));
}

function writeJson(dest, value) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(value));
}

const DEFAULT_BESTIARY_SOURCES = ['MM', 'XMM', 'MPMM', 'PHB', 'XPHB', 'VGM', 'MTF', 'TCE', 'EGW', 'FTD', 'ERLW', 'EFA', 'IDRotF', 'CoS', 'WDH', 'WDMM'];
const DEFAULT_SPELL_SOURCES = ['PHB', 'XPHB', 'XGE', 'TCE', 'AI', 'EGW', 'FTD', 'EFA', 'IDRotF', 'CoS', 'WDH', 'WDMM'];

async function fetchIndexMap(sub) {
  const target = path.join(DB, sub, 'index.json');
  const existing = readJsonFileOrEmpty(target);
  const localized = await fetchJsonOrNull(`${DND5E_CN_BASE}/${sub}/index.json`, `DND5E 不全书 ${sub} 索引`);
  const upstream = await fetchJsonOrNull(`${FIVETOOLS_BASE}/${sub}/index.json`, `5etools ${sub} 索引`);
  const merged = { ...existing, ...(upstream ?? {}), ...(localized ?? {}) };
  if (!localized && !upstream && Object.keys(existing).length) {
    console.warn(`[data-update] ${sub} 索引下载失败，保留已有 ${Object.keys(existing).length} 条来源映射`);
  }
  // Persist index.json at its final location so buildIndexFromDir's
  // readSourceMap() can find it later.
  writeJson(target, merged);
  return merged;
}

const bestiaryIndex = await fetchIndexMap('bestiary');
const spellsIndex = await fetchIndexMap('spells');
const classIndex = await fetchIndexMap('class');

const targets = new Set();
for (const src of DEFAULT_BESTIARY_SOURCES) {
  const f = bestiaryIndex[src];
  if (f) targets.add(`bestiary/${f}`);
}
for (const src of DEFAULT_SPELL_SOURCES) {
  const f = spellsIndex[src];
  if (f) targets.add(`spells/${f}`);
}
for (const file of Object.values(classIndex)) {
  if (typeof file === 'string' && file.endsWith('.json')) targets.add(`class/${file}`);
}
for (const f of [
  'items.json', 'items-base.json', 'feats.json', 'races.json', 'backgrounds.json', 'conditionsdiseases.json',
  'generated/gendata-spell-source-lookup.json',
]) targets.add(f);

let ok = 0, fail = 0;
for (const f of targets) {
  const dest = path.join(DB, f);
  try {
    const localized = await fetchJsonOrNull(`${DND5E_CN_BASE}/${f}`, `DND5E 不全书 ${f}`);
    const upstream = await fetchJsonOrNull(`${FIVETOOLS_BASE}/${f}`, `5etools ${f}`);
    if (!localized && !upstream) throw new Error('两个资料源均不可用');
    writeJson(dest, mergeData(upstream, localized));
    ok += 1;
  } catch (e) {
    fail += 1;
    console.warn(`[data-update] SKIP ${f}: ${e.message}`);
  }
}

await import('tsx/esm');
const { buildIndexFromDir, writeIndex } = await import('../server/src/search.ts');
const idx = await buildIndexFromDir(DB);
writeIndex(DB, idx);

const { buildCharacterRuleCatalog } = await import('./build-character-rules.mjs');
buildCharacterRuleCatalog(DB, path.join(DB, 'character-options.json'));

await networkDispatcher.close();
console.log(`[data-update] done: ${ok} files ok, ${fail} skipped, index entries: ${idx.length}`);
console.log(`[data-update] 已合并 DND5E 不全书中文数据与 5etools 英文元数据，数据位于 ${DB}。`);

async function fetchJsonOrNull(url, label) {
  try {
    return await fetchJson(url);
  } catch (error) {
    console.warn(`[data-update] ${label} 不可用：${error.message}`);
    return null;
  }
}

function readJsonFileOrEmpty(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function mergeData(upstream, localized) {
  if (!isRecord(upstream)) return localized;
  if (!isRecord(localized)) return upstream;
  const result = { ...upstream, ...localized };
  for (const key of new Set([...Object.keys(upstream), ...Object.keys(localized)])) {
    const englishEntries = upstream[key];
    const translatedEntries = localized[key];
    if (Array.isArray(englishEntries) && Array.isArray(translatedEntries)) {
      result[key] = mergeEntityArrays(englishEntries, translatedEntries);
    }
  }
  return result;
}

function mergeEntityArrays(upstream, localized) {
  const englishByIdentity = new Map();
  for (const entry of upstream) {
    const identity = entityIdentity(entry);
    if (identity) englishByIdentity.set(identity, entry);
  }
  const translatedIdentities = new Set();
  const merged = localized.map(entry => {
    const identity = entityIdentity(entry);
    if (!identity) return entry;
    translatedIdentities.add(identity);
    const english = englishByIdentity.get(identity);
    return isRecord(english) && isRecord(entry) ? { ...english, ...entry } : entry;
  });
  for (const entry of upstream) {
    const identity = entityIdentity(entry);
    if (!identity || !translatedIdentities.has(identity)) merged.push(entry);
  }
  return merged;
}

function entityIdentity(value) {
  if (!isRecord(value)) return null;
  const name = typeof value.ENG_name === 'string' ? value.ENG_name : value.name;
  if (typeof name !== 'string') return null;
  return `${typeof value.source === 'string' ? value.source : ''}\u0000${name}`;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
