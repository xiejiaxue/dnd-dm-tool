import fs from 'node:fs';
import path from 'node:path';
import { Scene } from './types';
import { createScene } from './scene';

export class SceneNotFoundError extends Error {
  constructor(id: string) {
    super(`scene not found: ${id}`);
    this.name = 'SceneNotFoundError';
  }
}

export class SceneStore {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private file(id: string) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`invalid scene id: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  async list(): Promise<{ id: string; name: string }[]> {
    const files = fs.readdirSync(this.dir).filter(f => f.endsWith('.json') && f !== 'last-scene.json');
    const out: { id: string; name: string }[] = [];
    for (const f of files) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as Scene;
        out.push({ id: s.id, name: s.name });
      } catch {
        // 忽略损坏文件
      }
    }
    return out;
  }

  async create(name: string): Promise<Scene> {
    const s = createScene(name);
    this.save(s);
    return s;
  }

  async get(id: string): Promise<Scene> {
    try {
      const raw = fs.readFileSync(this.file(id), 'utf8');
      return JSON.parse(raw) as Scene;
    } catch {
      throw new SceneNotFoundError(id);
    }
  }

  save(scene: Scene): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file(scene.id), JSON.stringify(scene, null, 2));
  }

  async delete(id: string): Promise<void> {
    const f = this.file(id);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  async last(): Promise<string | null> {
    try {
      const raw = fs.readFileSync(path.join(this.dir, 'last-scene.json'), 'utf8');
      return (JSON.parse(raw) as { id: string }).id ?? null;
    } catch {
      return null;
    }
  }

  setLast(id: string | null): void {
    if (id == null) {
      try { fs.unlinkSync(path.join(this.dir, 'last-scene.json')); } catch { /* noop */ }
      return;
    }
    fs.writeFileSync(path.join(this.dir, 'last-scene.json'), JSON.stringify({ id }));
  }
}
