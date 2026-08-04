import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { TokenService, circleCrop, placeholderSvg } from './tokens';
import { EntryService } from './entries';

const DB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures/db');
let dir: string;
let svc: TokenService;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokens-'));
  const entry = new EntryService(DB);
  await entry.warm();
  // imageBase 指向不存在的地址，走下载失败分支 → 占位
  svc = new TokenService(dir, entry, 'http://127.0.0.1:1/nonexist');
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('placeholderSvg', () => {
  it('produces an svg with the first char', () => {
    const s = placeholderSvg('地精');
    expect(s).toContain('<svg');
    expect(s).toContain('地');
  });
});

describe('circleCrop', () => {
  it('crops a square image into transparent circle png', async () => {
    const input = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const out = await circleCrop(input);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(512);
    expect(meta.hasAlpha).toBe(true);
    // 角落应为透明
    const pixel = await sharp(out).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    expect(pixel[3]).toBe(0);
  });
});

describe('TokenService.get', () => {
  it('download failure falls back to placeholder svg', async () => {
    const r = await svc.get('MM__Goblin');
    expect(r.contentType).toBe('image/svg+xml');
    expect(r.buffer.toString('utf8')).toContain('<svg');
  });

  it('caches the result file', () => {
    expect(fs.existsSync(path.join(dir, 'MM__Goblin.svg'))).toBe(true);
  });
});
