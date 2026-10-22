import fs from 'node:fs';
import path from 'node:path';
import Fuse from 'fuse.js';
import { EntryType, IndexEntry } from './types';
import { monsterHasToken, monsterHitPoints, monsterInitiativeModifier } from '../../shared/compendium';

export interface SourceMap { [source: string]: string }

export const DEFAULT_BOOKS = {
  bestiary: ['MM', 'XMM', 'MPMM', 'PHB', 'XPHB', 'VGM', 'MTF', 'TCE', 'EGW', 'FTD', 'ERLW', 'EFA', 'IDRotF', 'CoS', 'WDH', 'WDMM'],
  spells: ['PHB', 'XPHB', 'XGE', 'TCE', 'AI', 'EGW', 'FTD', 'EFA', 'IDRotF', 'CoS', 'WDH', 'WDMM'],
  singles: ['items.json', 'feats.json', 'conditionsdiseases.json'],
};

function loadJson(p: string): any {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function findArrayKey(obj: any): string | null {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) return k;
  }
  return null;
}

async function buildBestiaryIndex(dbDir: string, sourceMap: SourceMap, out: IndexEntry[]) {
  for (const [source, fileName] of Object.entries(sourceMap)) {
    const p = path.join(dbDir, 'bestiary', fileName);
    if (!fs.existsSync(p)) continue;
    const data = loadJson(p);
    const key = findArrayKey(data);
    if (!key) continue;
    for (const m of data[key] ?? []) {
      if (typeof m !== 'object' || m == null) continue;
      out.push({
        type: 'monster',
        id: `${source}__${m.ENG_name ?? m.name}`,
        nameZh: m.name ?? '',
        nameEn: m.ENG_name ?? m.name ?? '',
        source,
        bookFile: `bestiary/${fileName}`,
        cr: m.cr != null ? String(m.cr) : undefined,
        initiativeModifier: monsterInitiativeModifier(m),
        hitPoints: monsterHitPoints(m),
        hasToken: monsterHasToken(m),
      });
    }
  }
}

async function buildSpellIndex(dbDir: string, sourceMap: SourceMap, out: IndexEntry[]) {
  for (const [source, fileName] of Object.entries(sourceMap)) {
    const p = path.join(dbDir, 'spells', fileName);
    if (!fs.existsSync(p)) continue;
    const data = loadJson(p);
    const key = findArrayKey(data);
    if (!key) continue;
    for (const s of data[key] ?? []) {
      if (typeof s !== 'object' || s == null) continue;
      out.push({
        type: 'spell',
        id: `${source}__${s.ENG_name ?? s.name}`,
        nameZh: s.name ?? '',
        nameEn: s.ENG_name ?? s.name ?? '',
        source,
        bookFile: `spells/${fileName}`,
        level: s.level,
      });
    }
  }
}

async function buildSingleIndex(dbDir: string, fileName: string, type: EntryType, out: IndexEntry[]) {
  const p = path.join(dbDir, fileName);
  if (!fs.existsSync(p)) return;
  const data = loadJson(p);
  const key = findArrayKey(data);
  if (!key) return;
  for (const it of data[key] ?? []) {
    if (typeof it !== 'object' || it == null) continue;
    out.push({
      type,
      id: `${it.source ?? 'PHB'}__${it.ENG_name ?? it.name}`,
      nameZh: it.name ?? '',
      nameEn: it.ENG_name ?? it.name ?? '',
      source: it.source ?? 'PHB',
      bookFile: fileName,
    });
  }
}

export async function buildIndexFromDir(dbDir: string): Promise<IndexEntry[]> {
  const out: IndexEntry[] = [];
  const bestiaryMap = readSourceMap(dbDir, 'bestiary');
  const spellMap = readSourceMap(dbDir, 'spells');

  await buildBestiaryIndex(dbDir, bestiaryMap, out);
  await buildSpellIndex(dbDir, spellMap, out);
  for (const f of ['items.json', 'feats.json', 'conditionsdiseases.json']) {
    const type = f.startsWith('items') ? 'item' : f.startsWith('feats') ? 'feat' : 'condition';
    await buildSingleIndex(dbDir, f, type, out);
  }
  return out;
}

function readSourceMap(dbDir: string, sub: string): SourceMap {
  const idx = loadJson(path.join(dbDir, sub, 'index.json'));
  const map: SourceMap = {};
  for (const [source, fileName] of Object.entries(idx ?? {})) {
    if (typeof fileName === 'string') map[source] = fileName;
  }
  return map;
}

export function writeIndex(dbDir: string, entries: IndexEntry[]): void {
  fs.mkdirSync(dbDir, { recursive: true });
  fs.writeFileSync(path.join(dbDir, 'index.json'), JSON.stringify(entries));
}

export class SearchService {
  private entries: IndexEntry[] = [];
  private fuse: Fuse<IndexEntry> | null = null;

  constructor(private dbDir: string) {}

  async load(): Promise<void> {
    const p = path.join(this.dbDir, 'index.json');
    if (!fs.existsSync(p)) {
      const built = await buildIndexFromDir(this.dbDir);
      writeIndex(this.dbDir, built);
    }
    this.entries = JSON.parse(fs.readFileSync(path.join(this.dbDir, 'index.json'), 'utf8')) as IndexEntry[];
    this.fuse = new Fuse(this.entries, {
      keys: ['nameZh', 'nameEn'],
      threshold: 0.4,
      ignoreLocation: true,
    });
  }

  query(q: string, type: EntryType | 'all' = 'all'): IndexEntry[] {
    if (!this.fuse) return [];
    const trimmed = q.trim();
    if (!trimmed) return [];
    const scored = this.fuse.search(trimmed);
    const out = scored.map(r => r.item).filter(e => type === 'all' || e.type === type);
    return out.slice(0, 50);
  }
}
