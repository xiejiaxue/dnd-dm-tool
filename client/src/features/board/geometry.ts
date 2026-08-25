import { addFogReveal, fogExtent } from '../../../../shared/fog-rects';
import { FOG_CELL, fogGridSize, type FogRect, type GridConfig, type Scene } from '../../types';

export const MIN_BOARD_SCALE = 0.1;
export const MAX_BOARD_SCALE = 8;

export interface BoardViewport {
  scale: number;
  pos: { x: number; y: number };
}

export function snapCoordinate(value: number, grid: GridConfig, axis: 0 | 1): number {
  if (!grid.snap) return value;
  const offset = grid.offset[axis];
  return Math.round((value - offset) / grid.size) * grid.size + offset;
}

/** Zoom around one container-space point while preserving its world position. */
export function zoomViewport(viewport: BoardViewport, pointer: { x: number; y: number }, factor: number): BoardViewport {
  const nextScale = Math.min(MAX_BOARD_SCALE, Math.max(MIN_BOARD_SCALE, viewport.scale * factor));
  if (nextScale === viewport.scale) return viewport;
  const worldPoint = {
    x: (pointer.x - viewport.pos.x) / viewport.scale,
    y: (pointer.y - viewport.pos.y) / viewport.scale,
  };
  return {
    scale: nextScale,
    pos: {
      x: pointer.x - worldPoint.x * nextScale,
      y: pointer.y - worldPoint.y * nextScale,
    },
  };
}

export function fogCellAt(scene: Scene, worldX: number, worldY: number, mapScale = scene.mapScale ?? 1): number {
  const { cols, rows } = fogGridSize(scene);
  const fogScale = scene.mapImage ? mapScale : 1;
  const column = Math.floor(worldX / fogScale / FOG_CELL);
  const row = Math.floor(worldY / fogScale / FOG_CELL);
  if (column < 0 || row < 0 || column >= cols || row >= rows) return -1;
  return row * cols + column;
}

export function fogPointAt(scene: Scene, worldX: number, worldY: number, mapScale = scene.mapScale ?? 1): { x: number; y: number } {
  const fogScale = scene.mapImage ? mapScale : 1;
  const { width, height } = fogExtent(scene);
  return {
    x: Math.min(width, Math.max(0, worldX / fogScale)),
    y: Math.min(height, Math.max(0, worldY / fogScale)),
  };
}

export function fogRectBetween(start: { x: number; y: number }, end: { x: number; y: number }): FogRect | null {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  return w >= 1 && h >= 1 ? { x, y, w, h } : null;
}

/** Unrevealed cells touched by a square fog brush, clipped at grid edges. */
export function fogBrushCells(scene: Scene, worldX: number, worldY: number, radius: number, mapScale = scene.mapScale ?? 1): number[] {
  const center = fogCellAt(scene, worldX, worldY, mapScale);
  if (center < 0) return [];
  const { cols, rows } = fogGridSize(scene);
  const fogLength = scene.fog?.length ?? cols * rows;
  const centerColumn = center % cols;
  const centerRow = Math.floor(center / cols);
  const cells: number[] = [];
  for (let rowDelta = -radius; rowDelta <= radius; rowDelta += 1) {
    for (let columnDelta = -radius; columnDelta <= radius; columnDelta += 1) {
      const row = centerRow + rowDelta;
      const column = centerColumn + columnDelta;
      if (row < 0 || row >= rows || column < 0 || column >= cols) continue;
      const index = row * cols + column;
      if (index < fogLength && !(scene.fog?.[index])) cells.push(index);
    }
  }
  return cells;
}

/** Convert both the legacy cell grid and new pixel-precise boxes into revealed
 * rectangles in original-map coordinates. */
export function revealedFogRects(scene: Scene): FogRect[] {
  let rectangles = scene.fogReveals?.map(rect => ({ ...rect })) ?? [];
  const fog = scene.fog;
  if (!fog?.some(Boolean)) return rectangles;
  const { cols, rows } = fogGridSize(scene);
  const { width, height } = fogExtent(scene);
  for (let row = 0; row < rows; row += 1) {
    let column = 0;
    while (column < cols) {
      while (column < cols && !fog[row * cols + column]) column += 1;
      const start = column;
      while (column < cols && fog[row * cols + column]) column += 1;
      if (start < column) {
        rectangles = addFogReveal(rectangles, {
          x: start * FOG_CELL,
          y: row * FOG_CELL,
          w: Math.min(width, column * FOG_CELL) - start * FOG_CELL,
          h: Math.min(height, (row + 1) * FOG_CELL) - row * FOG_CELL,
        });
      }
    }
  }
  return rectangles;
}

/** Partition the still-covered part of the map into non-overlapping bands.
 * Rect edges are retained verbatim, so no fog-grid snapping is introduced. */
export function coveredFogRects(scene: Scene): FogRect[] {
  const { width, height } = fogExtent(scene);
  const reveals = revealedFogRects(scene).flatMap((rect) => {
    const x = Math.min(width, Math.max(0, rect.x));
    const y = Math.min(height, Math.max(0, rect.y));
    const right = Math.min(width, Math.max(0, rect.x + rect.w));
    const bottom = Math.min(height, Math.max(0, rect.y + rect.h));
    return right > x && bottom > y ? [{ x, y, w: right - x, h: bottom - y }] : [];
  });
  if (reveals.length === 0) return [{ x: 0, y: 0, w: width, h: height }];

  const yStops = [...new Set([0, height, ...reveals.flatMap(rect => [rect.y, rect.y + rect.h])])].sort((left, right) => left - right);
  const covered: FogRect[] = [];
  for (let index = 0; index < yStops.length - 1; index += 1) {
    const y = yStops[index];
    const bottom = yStops[index + 1];
    if (bottom <= y) continue;
    const intervals = reveals
      .filter(rect => rect.y < bottom && rect.y + rect.h > y)
      .map(rect => [rect.x, rect.x + rect.w] as [number, number])
      .sort((left, right) => left[0] - right[0]);
    let cursor = 0;
    for (const [left, right] of intervals) {
      if (left > cursor) covered.push({ x: cursor, y, w: left - cursor, h: bottom - y });
      cursor = Math.max(cursor, right);
    }
    if (cursor < width) covered.push({ x: cursor, y, w: width - cursor, h: bottom - y });
  }
  return covered;
}
