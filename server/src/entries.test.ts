import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EntryService, EntryNotFoundError } from './entries';

const DB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures/db');

describe('EntryService', () => {
  let svc: EntryService;
  beforeEach(async () => {
    svc = new EntryService(DB);
    await svc.warm(); // 构建/加载 index.json
  });

  it('loads a monster entry', async () => {
    const m = await svc.get('monster', 'MM__Goblin');
    expect(m).toMatchObject({ ENG_name: 'Goblin', name: '地精', source: 'MM' });
  });

  it('loads a spell entry', async () => {
    const s = await svc.get('spell', 'PHB__Fireball');
    expect(s.name).toBe('火球术');
    expect(s.level).toBe(3);
  });

  it('throws for unknown id', async () => {
    await expect(svc.get('monster', 'ZZ__Nope')).rejects.toBeInstanceOf(EntryNotFoundError);
  });

  it('disambiguates same-name entries by source', async () => {
    const phb = await svc.get('item', 'PHB__Longsword');
    expect(phb).toMatchObject({ source: 'PHB', cost: 1500 });
    const xge = await svc.get('item', 'XGE__Longsword');
    expect(xge).toMatchObject({ source: 'XGE', cost: 500 });
  });
});
