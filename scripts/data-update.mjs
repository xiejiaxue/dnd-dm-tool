// scripts/data-update.mjs — download 5etools-cn data into data/db and build the search index
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(ROOT, 'data', 'db');
const BASE = 'https://raw.githubusercontent.com/tjliqy/5etools-cn/cn2.0/data';
const UA = { 'User-Agent': 'Mozilla/5.0 (dnd-dm-tool)' };

const FILES = [
  ...['MM','XMM','MPMM','PHB','XPHB','VGM','MTF','TCE','EGW','FTD','IDRotF','CoS','WDH','WDMM'].map(s => `bestiary/bestiary-${s.toLowerCase().replace(/[^a-z0-9]/g, '')}.json`),
  ...['PHB','XPHB','XGE','TCE','AI','EGW','FTD','IDRotF','CoS','WDH','WDMM'].map(s => `spells/spells-${s.toLowerCase().replace(/[^a-z0-9]/g, '')}.json`),
  'items.json', 'feats.json', 'conditionsdiseases.json',
];

const https = await import('node:https');
const http = await import('node:http');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(u, { headers: UA }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        resolve(download(new URL(res.headers.location, url), dest));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`${url} -> ${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.concat(chunks));
        resolve();
      });
    });
    req.on('error', reject);
  });
}

const DEFAULT_BESTIARY_SOURCES = ['MM', 'XMM', 'MPMM', 'PHB', 'XPHB', 'VGM', 'MTF', 'TCE', 'EGW', 'FTD', 'IDRotF', 'CoS', 'WDH', 'WDMM'];
const DEFAULT_SPELL_SOURCES = ['PHB', 'XPHB', 'XGE', 'TCE', 'AI', 'EGW', 'FTD', 'IDRotF', 'CoS', 'WDH', 'WDMM'];

async function fetchIndexMap(sub) {
  try {
    // Persist index.json at its final location so buildIndexFromDir's
    // readSourceMap() can find it later.
    const dest = path.join(DB, sub, 'index.json');
    await download(`${BASE}/${sub}/index.json`, dest);
    return JSON.parse(fs.readFileSync(dest, 'utf8'));
  } catch (e) {
    console.warn(`[data-update] index.json for ${sub} failed: ${e.message}`);
    return {};
  }
}

const bestiaryIndex = await fetchIndexMap('bestiary');
const spellsIndex = await fetchIndexMap('spells');

const targets = new Set();
for (const src of DEFAULT_BESTIARY_SOURCES) {
  const f = bestiaryIndex[src];
  if (f) targets.add(`bestiary/${f}`);
}
for (const src of DEFAULT_SPELL_SOURCES) {
  const f = spellsIndex[src];
  if (f) targets.add(`spells/${f}`);
}
for (const f of ['items.json', 'feats.json', 'conditionsdiseases.json']) targets.add(f);

let ok = 0, fail = 0;
for (const f of targets) {
  const dest = path.join(DB, f);
  try {
    await download(`${BASE}/${f}`, dest);
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

console.log(`[data-update] done: ${ok} files ok, ${fail} skipped, index entries: ${idx.length}`);
console.log(`[data-update] 数据位于 ${DB}，如镜像不可达可设镜像源再运行。`);
