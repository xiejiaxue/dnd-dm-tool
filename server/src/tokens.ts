import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { EntryService } from './entries';
import { EntryType } from './types';

const TOKEN_SIZE = 512;

export function placeholderSvg(name: string): string {
  const char = (name || '?').trim().charAt(0) || '?';
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TOKEN_SIZE}" height="${TOKEN_SIZE}">
<circle cx="256" cy="256" r="256" fill="hsl(${hue},45%,38%)"/>
<text x="256" y="310" font-size="240" text-anchor="middle" fill="#fff" font-family="sans-serif">${char}</text>
</svg>`;
}

export async function circleCrop(input: Buffer): Promise<Buffer> {
  const img = sharp(input);
  const meta = await img.metadata();
  const w = meta.width ?? TOKEN_SIZE;
  const h = meta.height ?? TOKEN_SIZE;
  const square = await img
    .resize(TOKEN_SIZE, TOKEN_SIZE, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  const mask = Buffer.from(
    `<svg width="${TOKEN_SIZE}" height="${TOKEN_SIZE}"><circle cx="${TOKEN_SIZE / 2}" cy="${TOKEN_SIZE / 2}" r="${TOKEN_SIZE / 2}" fill="#fff"/></svg>`,
  );
  const out = await sharp(square).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  void w; void h;
  return out;
}

export class TokenService {
  constructor(
    private cacheDir: string,
    private entrySvc: EntryService,
    private imageBase = 'https://5e.tools',
  ) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  async get(entryId: string): Promise<{ buffer: Buffer; contentType: string }> {
    const pngPath = path.join(this.cacheDir, `${entryId}.png`);
    if (fs.existsSync(pngPath)) {
      return { buffer: fs.readFileSync(pngPath), contentType: 'image/png' };
    }
    const svgPath = path.join(this.cacheDir, `${entryId}.svg`);
    if (fs.existsSync(svgPath)) {
      return { buffer: fs.readFileSync(svgPath), contentType: 'image/svg+xml' };
    }
    try {
      const monster = await this.entrySvc.get('monster', entryId);
      // Try common extensions in order; many 5etools portraits are .jpg but
      // some are .png/.webp. Falls through to the placeholder if all fail.
      const base = `${this.imageBase}/img/bestiary/${monster.source}/${monster.ENG_name}`;
      const buf = await fetchFirst(base, ['.jpg', '.png', '.webp']);
      const cropped = await circleCrop(buf);
      fs.writeFileSync(pngPath, cropped);
      return { buffer: cropped, contentType: 'image/png' };
    } catch {
      const name = await this.safeName(entryId);
      const svg = Buffer.from(placeholderSvg(name));
      fs.writeFileSync(svgPath, svg);
      return { buffer: svg, contentType: 'image/svg+xml' };
    }
  }

  private async safeName(entryId: string): Promise<string> {
    try {
      const m = await this.entrySvc.get('monster', entryId);
      return m.name ?? entryId;
    } catch {
      return entryId;
    }
  }
}

async function fetchImage(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (dnd-dm-tool)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) throw new Error('image too small');
  return buf;
}

async function fetchFirst(base: string, exts: string[]): Promise<Buffer> {
  let lastErr: unknown;
  for (const ext of exts) {
    try {
      return await fetchImage(`${base}${ext}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('no image found');
}
