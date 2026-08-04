import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp } from './routes';
import { SceneStore } from './store';
import { SearchService } from './search';
import { EntryService } from './entries';
import { TokenService } from './tokens';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures/db');

let app: any;
let store: SceneStore;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-'));
  store = new SceneStore(path.join(dir, 'scenes'));
  const search = new SearchService(FIXTURES);
  await search.load();
  const entries = new EntryService(FIXTURES);
  await entries.warm();
  const tokens = new TokenService(path.join(dir, 'tokens'), entries, 'http://127.0.0.1:1/nonexist');
  app = createApp({
    store, search, entries, tokens,
    uploadsDir: path.join(dir, 'uploads'),
    online: () => 2,
    dataReady: () => true,
    verifyPassword: (p: string) => p === 'secret',
  });
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('REST API', () => {
  it('meta', async () => {
    const res = await request(app).get('/api/meta');
    expect(res.status).toBe(200);
    expect(res.body.online).toBe(2);
    expect(res.body.dataReady).toBe(true);
  });

  it('search monsters by Chinese', async () => {
    const res = await request(app).get('/api/search').query({ q: '地精', type: 'monster' });
    expect(res.status).toBe(200);
    expect(res.body.some((x: any) => x.id === 'MM__Goblin')).toBe(true);
  });

  it('get entry', async () => {
    const res = await request(app).get('/api/entry/monster/MM__Goblin');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('地精');
  });

  it('token placeholder on download failure', async () => {
    const res = await request(app).get('/api/token/MM__Goblin');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
  });

  it('scenes CRUD', async () => {
    const c = await request(app).post('/api/scenes').send({ name: '地牢' });
    expect(c.status).toBe(201);
    const id = c.body.id;
    const g = await request(app).get(`/api/scenes/${id}`);
    expect(g.body.name).toBe('地牢');
    const list = await request(app).get('/api/scenes');
    expect(list.body.some((x: any) => x.id === id)).toBe(true);
    const d = await request(app).delete(`/api/scenes/${id}`);
    expect(d.status).toBe(200);
  });

  it('password verify', async () => {
    expect((await request(app).post('/api/verify-password').send({ password: 'secret' })).body.ok).toBe(true);
    expect((await request(app).post('/api/verify-password').send({ password: 'wrong' })).body.ok).toBe(false);
  });

  it('delete scene with invalid id returns 500 without hanging', async () => {
    const res = await request(app).delete('/api/scenes/' + encodeURIComponent('scene 1'));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('server error');
  });
});
