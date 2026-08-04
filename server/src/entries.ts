import fs from 'node:fs';
import path from 'node:path';
import { EntryType, IndexEntry } from './types';

export class EntryNotFoundError extends Error {
  constructor(id: string) {
    super(`entry not found: ${id}`);
    this.name = 'EntryNotFoundError';
  }
}

const LRU_CAP = 20;

export class EntryService {
  private index: IndexEntry[] = [];
  private cache = new Map<string, any>();

  constructor(private dbDir: string) {}

  async warm(): Promise<void> {
    const p = path.join(this.dbDir, 'index.json');
    if (!fs.existsSync(p)) throw new Error('数据未初始化：请先运行 npm run data:update');
    this.index = JSON.parse(fs.readFileSync(p, 'utf8')) as IndexEntry[];
  }

  private async loadFile(bookFile: string): Promise<any> {
    const hit = this.cache.get(bookFile);
    if (hit) {
      this.cache.delete(bookFile);
      this.cache.set(bookFile, hit);
      return hit;
    }
    const p = path.join(this.dbDir, bookFile);
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = Object.values(data).find(v => Array.isArray(v)) as any[] | undefined;
    this.cache.set(bookFile, arr ?? []);
    if (this.cache.size > LRU_CAP) {
      const first = this.cache.keys().next().value;
      if (first != null) this.cache.delete(first);
    }
    return this.cache.get(bookFile);
  }

  async get(type: EntryType, id: string): Promise<any> {
    const entry = this.index.find(e => e.type === type && e.id === id);
    if (!entry) throw new EntryNotFoundError(id);
    const arr = await this.loadFile(entry.bookFile);
    const found = arr.find((x: any) => (x.ENG_name ?? x.name) === entry.nameEn && x.source === entry.source);
    if (!found) throw new EntryNotFoundError(id);
    return found;
  }
}
