import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { DiceStyle, TrayTheme } from './settings';

/** Everything drawn here is procedural, so the tray needs no image downloads. */
type Draw = (ctx: CanvasRenderingContext2D, width: number, height: number, random: () => number) => void;
function seeded(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}
const cache = new Map<string, CanvasTexture>();
function paint(id: string, width: number, height: number, draw: Draw, repeat = false): CanvasTexture {
  const key = `${id}:${width}x${height}`, cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d')!, width, height, seeded(width * 31 + height + id.length * 977));
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; texture.anisotropy = 4;
  if (repeat) texture.wrapS = texture.wrapT = RepeatWrapping;
  cache.set(key, texture);
  return texture;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, random: () => number, count: number, colors: string[], size = 1.6) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    ctx.globalAlpha = .05 + random() * .12;
    ctx.fillRect(random() * w, random() * h, size * (.5 + random()), size * (.5 + random()));
  }
  ctx.globalAlpha = 1;
}
function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, edge: string, strength: number) {
  const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .2, w / 2, h / 2, Math.hypot(w, h) * .55);
  gradient.addColorStop(0, 'rgba(0,0,0,0)'); gradient.addColorStop(1, edge);
  ctx.globalAlpha = strength; ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
}
/** A flat d20 silhouette: hexagon outline with the front triangle and its spokes. */
function d20Emblem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const hex = Array.from({ length: 6 }, (_, i) => [x + r * Math.cos(Math.PI / 6 + i * Math.PI / 3), y + r * Math.sin(Math.PI / 6 + i * Math.PI / 3)]);
  const tri = [[x, y - r * .62], [x + r * .54, y + r * .31], [x - r * .54, y + r * .31]];
  ctx.beginPath(); hex.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath();
  ctx.moveTo(tri[0][0], tri[0][1]); tri.forEach(([px, py]) => ctx.lineTo(px, py)); ctx.closePath();
  for (const [i, j] of [[0, 4], [0, 5], [1, 5], [1, 0], [2, 0], [2, 1], [2, 2], [2, 3], [1, 3], [1, 4]] as const) {
    ctx.moveTo(tri[i][0], tri[i][1]); ctx.lineTo(hex[j][0], hex[j][1]);
  }
  ctx.stroke();
}

const velvet: Draw = (ctx, w, h, random) => {
  ctx.fillStyle = '#5a1620'; ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, random, w * h / 18, ['#3a0b12', '#7a2430', '#6b1b26'], 1.4);
  // Pile brushed in one direction leaves soft light bands.
  for (let i = 0; i < 26; i++) {
    const x = random() * w, band = ctx.createLinearGradient(x - 60, 0, x + 60, 0);
    band.addColorStop(0, 'rgba(255,190,190,0)'); band.addColorStop(.5, 'rgba(255,190,190,.035)'); band.addColorStop(1, 'rgba(255,190,190,0)');
    ctx.fillStyle = band; ctx.fillRect(x - 60, 0, 120, h);
  }
  ctx.strokeStyle = 'rgba(214,170,92,.22)'; ctx.lineWidth = Math.max(2, w / 400);
  d20Emblem(ctx, w / 2, h / 2, Math.min(w, h) * .2);
  ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * .27, 0, Math.PI * 2); ctx.stroke();
  vignette(ctx, w, h, '#14040a', .75);
};
function flagstones(tile: number, base: number, mortar: string): Draw {
  return (ctx, w, h, random) => {
    ctx.fillStyle = mortar; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += tile) for (let x = 0; x < w; x += tile) {
      const shade = base + Math.floor((random() - .5) * 22), gap = tile * .035;
      ctx.fillStyle = `rgb(${shade},${shade + 2},${shade + 6})`;
      ctx.beginPath();
      ctx.moveTo(x + gap + random() * gap, y + gap + random() * gap);
      ctx.lineTo(x + tile - gap - random() * gap, y + gap + random() * gap);
      ctx.lineTo(x + tile - gap - random() * gap, y + tile - gap - random() * gap);
      ctx.lineTo(x + gap + random() * gap, y + tile - gap - random() * gap);
      ctx.closePath(); ctx.fill();
      ctx.save(); ctx.clip();
      speckle(ctx, w, h, random, tile * tile / 30, ['#000', '#fff'], 2);
      if (random() < .35) {
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.2; ctx.beginPath();
        let cx = x + random() * tile, cy = y + random() * tile; ctx.moveTo(cx, cy);
        for (let k = 0; k < 4; k++) { cx += (random() - .5) * tile * .5; cy += (random() - .5) * tile * .5; ctx.lineTo(cx, cy); }
        ctx.stroke();
      }
      ctx.restore();
    }
  };
}
function dungeonFloor(tile: number): Draw {
  const stones = flagstones(tile, 78, '#23211f');
  return (ctx, w, h, random) => {
    stones(ctx, w, h, random);
    // Torch soot towards the walls and a faint chalked rune circle in the middle.
    ctx.strokeStyle = 'rgba(220,214,190,.18)'; ctx.lineWidth = Math.max(2, w / 500);
    const r = Math.min(w, h) * .3;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.arc(w / 2, h / 2, r * .86, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + i * 4 * Math.PI / 5;
      ctx[i ? 'lineTo' : 'moveTo'](w / 2 + Math.cos(a) * r * .86, h / 2 + Math.sin(a) * r * .86);
    }
    ctx.stroke();
    vignette(ctx, w, h, '#050403', .85);
  };
}
const parchment: Draw = (ctx, w, h, random) => {
  ctx.fillStyle = '#e4cf9f'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const x = random() * w, y = random() * h, r = 30 + random() * w * .12, stain = ctx.createRadialGradient(x, y, 0, x, y, r);
    stain.addColorStop(0, `rgba(150,105,50,${.05 + random() * .08})`); stain.addColorStop(1, 'rgba(150,105,50,0)');
    ctx.fillStyle = stain; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  speckle(ctx, w, h, random, w * h / 40, ['#8a6a3a', '#fff4d8'], 1.5);
  const ink = 'rgba(70,45,20,.55)', unit = w / 14;
  ctx.strokeStyle = 'rgba(90,60,30,.12)'; ctx.lineWidth = 1;
  for (let x = 0; x < w; x += unit) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += unit) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  // Coastline, mountains, forest and a dashed route between two waypoints.
  ctx.strokeStyle = ink; ctx.lineWidth = Math.max(2, w / 420); ctx.beginPath();
  let x = w * .05, y = h * .25; ctx.moveTo(x, y);
  while (x < w * .55) { x += unit * (.3 + random() * .4); y += (random() - .45) * unit * .8; ctx.lineTo(x, y); }
  ctx.stroke();
  for (let i = 0; i < 7; i++) {
    const mx = w * (.58 + random() * .32), my = h * (.15 + random() * .3), s = unit * (.35 + random() * .25);
    ctx.beginPath(); ctx.moveTo(mx - s, my + s * .6); ctx.lineTo(mx, my - s * .6); ctx.lineTo(mx + s, my + s * .6); ctx.stroke();
  }
  for (let i = 0; i < 14; i++) {
    const tx = w * (.08 + random() * .3), ty = h * (.6 + random() * .3), s = unit * .18;
    ctx.beginPath(); ctx.arc(tx, ty, s, 0, Math.PI * 2); ctx.moveTo(tx, ty + s); ctx.lineTo(tx, ty + s * 2); ctx.stroke();
  }
  ctx.setLineDash([unit * .18, unit * .14]); ctx.beginPath(); ctx.moveTo(w * .22, h * .72);
  ctx.bezierCurveTo(w * .4, h * .5, w * .55, h * .85, w * .74, h * .62); ctx.stroke(); ctx.setLineDash([]);
  ctx.lineWidth = Math.max(3, w / 300);
  for (const [cx, cy] of [[w * .74, h * .62]]) { const s = unit * .2; ctx.beginPath(); ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s); ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s); ctx.stroke(); }
  // Compass rose.
  const cx = w * .86, cy = h * .8, r = Math.min(w, h) * .09;
  ctx.fillStyle = ink; ctx.lineWidth = Math.max(1.5, w / 600);
  ctx.beginPath(); ctx.arc(cx, cy, r * .75, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 - Math.PI / 2, side = a + Math.PI / 2;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.lineTo(cx + Math.cos(side) * r * .16, cy + Math.sin(side) * r * .16); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill();
  }
  ctx.font = `600 ${Math.round(r * .32)}px Georgia, serif`; ctx.textAlign = 'center'; ctx.fillText('N', cx, cy - r * 1.12);
  vignette(ctx, w, h, '#5a3a18', .55);
};
const scales: Draw = (ctx, w, h, random) => {
  ctx.fillStyle = '#1d0c0c'; ctx.fillRect(0, 0, w, h);
  const s = w / 26;
  for (let row = -1; row * s * .5 < h + s; row++) for (let col = -1; col * s < w + s; col++) {
    const x = col * s + (row % 2 ? s / 2 : 0), y = row * s * .5, tone = 48 + random() * 34;
    const g = ctx.createRadialGradient(x, y - s * .2, 0, x, y, s * .65);
    g.addColorStop(0, `rgb(${tone + 40},${tone * .45},${tone * .4})`); g.addColorStop(1, `rgb(${tone * .5},${tone * .2},${tone * .2})`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s * .58, 0, Math.PI); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1.2; ctx.stroke();
  }
  // Hoard glints scattered towards the rim.
  for (let i = 0; i < 160; i++) {
    const a = random() * Math.PI * 2, d = .62 + random() * .4, x = w / 2 + Math.cos(a) * w / 2 * d, y = h / 2 + Math.sin(a) * h / 2 * d, r = 3 + random() * 6;
    const coin = ctx.createRadialGradient(x - r * .3, y - r * .3, 0, x, y, r);
    coin.addColorStop(0, '#fff1b0'); coin.addColorStop(.5, '#d6a33c'); coin.addColorStop(1, '#6b4511');
    ctx.fillStyle = coin; ctx.beginPath(); ctx.ellipse(x, y, r, r * .8, random() * 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(214,163,60,.3)'; ctx.lineWidth = Math.max(2, w / 400);
  d20Emblem(ctx, w / 2, h / 2, Math.min(w, h) * .18);
  vignette(ctx, w, h, '#000', .7);
};
const plain = (color: string): Draw => (ctx, w, h) => { ctx.fillStyle = color; ctx.fillRect(0, 0, w, h); };
function planks(colors: [string, string, string], plank = 64): Draw {
  return (ctx, w, h, random) => {
    for (let y = 0; y < h; y += plank) {
      ctx.fillStyle = colors[Math.floor(random() * 2)]; ctx.fillRect(0, y, w, plank);
      ctx.strokeStyle = colors[2]; ctx.globalAlpha = .25; ctx.lineWidth = 1;
      for (let k = 0; k < 9; k++) {
        const base = y + random() * plank, amp = 1 + random() * 4, freq = .004 + random() * .01, phase = random() * 9;
        ctx.beginPath(); for (let x = 0; x <= w; x += 8) ctx.lineTo(x, base + Math.sin(x * freq + phase) * amp); ctx.stroke();
      }
      ctx.globalAlpha = .6; ctx.fillStyle = colors[2]; ctx.fillRect(0, y, w, 2);
      const seam = random() * w; ctx.fillRect(seam, y, 2, plank); ctx.globalAlpha = 1;
    }
  };
}
const wood = (colors: [string, string, string]) => planks(colors, 512);
const stoneBlocks: Draw = (ctx, w, h, random) => {
  ctx.fillStyle = '#2f2c28'; ctx.fillRect(0, 0, w, h);
  const bw = w / 4, bh = h / 2;
  for (let row = 0; row < 2; row++) for (let col = -1; col < 5; col++) {
    const x = col * bw + (row ? bw / 2 : 0), shade = 92 + Math.floor((random() - .5) * 30);
    ctx.fillStyle = `rgb(${shade},${shade - 2},${shade - 6})`; ctx.fillRect(x + 3, row * bh + 3, bw - 6, bh - 6);
  }
  speckle(ctx, w, h, random, w * h / 12, ['#000', '#fff'], 2);
};
const obsidian: Draw = (ctx, w, h, random) => {
  ctx.fillStyle = '#0d0b10'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 30; i++) {
    ctx.strokeStyle = `rgba(${120 + random() * 80},${90 + random() * 40},180,.08)`; ctx.lineWidth = 1 + random() * 3;
    ctx.beginPath(); ctx.moveTo(random() * w, 0); ctx.lineTo(random() * w, h); ctx.stroke();
  }
  ctx.fillStyle = '#c99a3a'; ctx.fillRect(0, 0, w, Math.max(3, h * .08));
};

export interface ThemeLook {
  clear: string;
  ambient: [string, number];
  key: [string, number];
  fill: [string, number];
  /** A warm point light placed past the back-left corner, like a candle or torch. */
  glow?: [string, number];
  floor: (aspect: number) => CanvasTexture;
  floorRoughness: number;
  table: () => CanvasTexture;
  tableRepeat: number;
  rail: () => CanvasTexture;
  railRoughness: number;
  railMetalness: number;
  /** Swiss mode keeps its thin outline instead of a solid rail. */
  outline?: string;
}
// Heights snap to 64 px so resizing the window reuses a handful of cached floors.
const floorSize = (aspect: number): [number, number] => [1024, Math.round(1024 / Math.max(.5, Math.min(2.5, aspect)) / 64) * 64];
export const THEMES: Record<TrayTheme, ThemeLook> = {
  tavern: {
    clear: '#140d09', ambient: ['#ffd8a8', .55], key: ['#ffe0b5', 1.7], fill: ['#8fa6ff', .18], glow: ['#ff9f45', 260],
    floor: aspect => paint('velvet', ...floorSize(aspect), velvet), floorRoughness: .95,
    table: () => paint('oak', 512, 512, planks(['#4a2e1b', '#55351f', '#1d110a']), true), tableRepeat: 7,
    rail: () => paint('walnut', 512, 64, wood(['#5b3720', '#5b3720', '#26150b'])), railRoughness: .55, railMetalness: 0,
  },
  dungeon: {
    clear: '#0b0a09', ambient: ['#b9c2d6', .38], key: ['#f2e6d0', 1.25], fill: ['#7f8fb8', .2], glow: ['#ff8a30', 380],
    floor: aspect => paint('flagstones', ...floorSize(aspect), dungeonFloor(1024 / 8)), floorRoughness: .9,
    table: () => paint('cobble', 512, 512, flagstones(128, 46, '#121110'), true), tableRepeat: 8,
    rail: () => paint('stone', 512, 128, stoneBlocks), railRoughness: .92, railMetalness: 0,
  },
  map: {
    clear: '#2a1d12', ambient: ['#fff1d6', .75], key: ['#fff4e0', 1.6], fill: ['#c9d6ff', .25],
    floor: aspect => paint('parchment', ...floorSize(aspect), parchment), floorRoughness: .85,
    table: () => paint('desk', 512, 512, planks(['#6b4426', '#734a2a', '#2e1b0e'], 128), true), tableRepeat: 6,
    rail: () => paint('leather', 512, 64, wood(['#7a4a22', '#7a4a22', '#3a200c'])), railRoughness: .7, railMetalness: 0,
  },
  lair: {
    clear: '#070405', ambient: ['#ff9a7a', .5], key: ['#ffd2a0', 1.35], fill: ['#7a5cff', .22], glow: ['#ff4a1a', 420],
    floor: aspect => paint('scales', ...floorSize(aspect), scales), floorRoughness: .6,
    table: () => paint('basalt', 512, 512, flagstones(256, 30, '#0a0606'), true), tableRepeat: 6,
    rail: () => paint('obsidian', 512, 64, obsidian), railRoughness: .25, railMetalness: .35,
  },
  swiss: {
    clear: '#eeede6', ambient: ['#ffffff', .85], key: ['#ffffff', 1.8], fill: ['#ffffff', .35],
    floor: () => paint('swiss-floor', 4, 4, plain('#e5e3da')), floorRoughness: 1,
    table: () => paint('swiss-table', 4, 4, plain('#e5e3da'), true), tableRepeat: 1,
    rail: () => paint('swiss-rail', 4, 4, plain('#d9d8cf')), railRoughness: 1, railMetalness: 0,
    outline: '#999d92',
  },
};

export interface DiceLook { body: string; edge: string; ink: string; roughness: number; metalness: number; serif: boolean }
export const DICE_LOOKS: Record<DiceStyle, DiceLook> = {
  crimson: { body: '#ba3526', edge: '#75241c', ink: '#fffdf8', roughness: .55, metalness: 0, serif: false },
  obsidian: { body: '#17151b', edge: '#000000', ink: '#e2b85c', roughness: .28, metalness: .25, serif: true },
  bone: { body: '#e9dcc0', edge: '#8b7a5a', ink: '#3b2414', roughness: .7, metalness: 0, serif: true },
  emerald: { body: '#17694c', edge: '#0b3526', ink: '#f4ecd2', roughness: .3, metalness: .05, serif: true },
  arcane: { body: '#4a2a86', edge: '#25124a', ink: '#d9e6ff', roughness: .35, metalness: .15, serif: true },
};
