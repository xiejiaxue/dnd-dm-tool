import { describe, expect, it } from 'vitest';
import { coveredFogRects, fogBrushCells, fogCellAt, fogRectBetween, snapCoordinate, zoomViewport } from '../features/board/geometry';
import { fogGridSize } from '../types';
import type { Scene } from '../types';

const scene: Scene = {
  id: 'scene', name: 'Board', mapImage: null, mapSize: [1600, 1200],
  grid: { size: 100, color: '#00000040', offset: [10, 20], snap: true },
  playArea: { x: 0, y: 0, w: 1600, h: 1200 },
  tokens: [], players: [], walls: [], initiative: [], favorites: [],
};

describe('board geometry', () => {
  it('snaps each axis against its own grid offset', () => {
    expect(snapCoordinate(164, scene.grid, 0)).toBe(210);
    expect(snapCoordinate(164, scene.grid, 1)).toBe(120);
  });

  it('keeps the world point under the zoom anchor fixed', () => {
    const before = { scale: 1, pos: { x: 10, y: 20 } };
    const pointer = { x: 210, y: 320 };
    const after = zoomViewport(before, pointer, 2);
    expect((pointer.x - after.pos.x) / after.scale).toBe((pointer.x - before.pos.x) / before.scale);
    expect((pointer.y - after.pos.y) / after.scale).toBe((pointer.y - before.pos.y) / before.scale);
  });

  it('clips a fog brush at the left edge instead of wrapping rows', () => {
    expect(fogBrushCells(scene, 1, 51, 1)).toEqual([0, 1, 32, 33, 64, 65]);
  });

  it('keeps fog indexes stable and maps pointers through map calibration scale', () => {
    const mapScene: Scene = { ...scene, mapImage: '/map.png', mapScale: 2 };
    expect(fogGridSize(mapScene)).toEqual({ cols: 32, rows: 24 });
    expect(fogGridSize({ ...mapScene, mapScale: 0.5 })).toEqual({ cols: 32, rows: 24 });
    expect(fogCellAt(mapScene, 100, 100)).toBe(33);
    expect(fogCellAt({ ...mapScene, mapScale: 0.5 }, 25, 25)).toBe(33);
  });

  it('keeps arbitrary drag-box edges instead of snapping to fog cells', () => {
    expect(fogRectBetween({ x: 96.25, y: 73.5 }, { x: 12.5, y: 27.25 })).toEqual({
      x: 12.5, y: 27.25, w: 83.75, h: 46.25,
    });

    const mapScene: Scene = {
      ...scene,
      mapImage: '/map.png',
      mapSize: [200, 120],
      fogReveals: [{ x: 12.5, y: 27.25, w: 83.75, h: 46.25 }],
    };
    const covered = coveredFogRects(mapScene);
    const coveredArea = covered.reduce((total, rect) => total + rect.w * rect.h, 0);
    expect(coveredArea).toBeCloseTo(200 * 120 - 83.75 * 46.25);
    expect(covered.some(rect => rect.x + rect.w === 12.5)).toBe(true);
    expect(covered.some(rect => rect.x === 96.25)).toBe(true);
  });
});
