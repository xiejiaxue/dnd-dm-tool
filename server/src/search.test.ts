import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndexFromDir, writeIndex, SearchService } from './search';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures/db');

describe('buildIndexFromDir', () => {
  it('builds index from fixture db', async () => {
    const idx = await buildIndexFromDir(FIXTURES);
    expect(idx.length).toBeGreaterThanOrEqual(3);
    const goblin = idx.find(e => e.id === 'MM__Goblin');
    expect(goblin).toMatchObject({ type: 'monster', nameZh: '地精', nameEn: 'Goblin', cr: '1/4', bookFile: 'bestiary/bestiary-mm.json' });
    const fb = idx.find(e => e.id === 'PHB__Fireball');
    expect(fb).toMatchObject({ type: 'spell', level: 3, bookFile: 'spells/spells-phb.json' });
    const ls = idx.find(e => e.id === 'PHB__Longsword');
    expect(ls).toMatchObject({ type: 'item', bookFile: 'items.json' });
  });
});

describe('SearchService', () => {
  let svc: SearchService;
  beforeEach(async () => {
    svc = new SearchService(FIXTURES);
    await svc.load();
  });

  it('fuzzy matches Chinese name', () => {
    const r = svc.query('地精');
    expect(r.some(x => x.id === 'MM__Goblin')).toBe(true);
  });

  it('fuzzy matches English name', () => {
    const r = svc.query('goblin');
    expect(r.some(x => x.id === 'MM__Goblin')).toBe(true);
  });

  it('filters by type', () => {
    const r = svc.query('术', 'spell');
    expect(r.every(x => x.type === 'spell')).toBe(true);
  });

  it('returns empty on no match', () => {
    expect(svc.query('zzzz不存在zzzz')).toEqual([]);
  });
});
