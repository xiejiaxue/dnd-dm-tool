import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndexFromDir } from './compendium-index';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/compendium-db');

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
