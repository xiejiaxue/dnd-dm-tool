import { subtractFogRectangle, type FogRectangle } from '../../../shared/fog';
import { fogGeometry, type Scene } from '../types';

export function fogCellAtPoint(scene: Scene, x: number, y: number, displayScale = scene.mapScale ?? 1): number {
  const grid = fogGeometry(scene, displayScale);
  const localX = (x - grid.x) / grid.scale, localY = (y - grid.y) / grid.scale;
  if (localX < 0 || localY < 0 || localX >= grid.width || localY >= grid.height) return -1;
  return Math.floor(localY / grid.cellSize) * grid.cols + Math.floor(localX / grid.cellSize);
}

export type { FogRectangle } from '../../../shared/fog';
/** Merge covered runs vertically, avoiding one React/Konva node per fog cell. */
function coveredGridRectangles(scene: Scene): FogRectangle[] {
  const grid = fogGeometry(scene);
  if (!scene.fog?.some(Boolean)) return [{ x: 0, y: 0, width: grid.width, height: grid.height }];
  const result: FogRectangle[] = [];
  let previous = new Map<string, FogRectangle>();
  for (let row = 0; row < grid.rows; row++) {
    const current = new Map<string, FogRectangle>();
    for (let col = 0; col < grid.cols;) {
      if (scene.fog[row * grid.cols + col]) { col++; continue; }
      const start = col;
      while (col < grid.cols && !scene.fog[row * grid.cols + col]) col++;
      const key = `${start}:${col}`;
      const height = Math.min(grid.cellSize, grid.height - row * grid.cellSize);
      let rect = previous.get(key);
      if (rect) rect.height += height;
      else {
        rect = { x: start * grid.cellSize, y: row * grid.cellSize, width: Math.min((col - start) * grid.cellSize, grid.width - start * grid.cellSize), height };
        result.push(rect);
      }
      current.set(key, rect);
    }
    previous = current;
  }
  return result;
}

/** Subtract exact reveals from the legacy brush raster without rounding edges. */
export function fogRectangles(scene: Scene): FogRectangle[] {
  let covered = coveredGridRectangles(scene);
  for (const reveal of scene.fogReveals ?? []) covered = covered.flatMap(rect => subtractFogRectangle(rect, reveal));
  return covered;
}

export function fogSelectionRectangle(scene: Scene, start: {x:number;y:number}, end: {x:number;y:number}, displayScale = scene.mapScale ?? 1): FogRectangle | null {
  const grid = fogGeometry(scene, displayScale);
  const left = Math.max(0, (Math.min(start.x,end.x)-grid.x)/grid.scale);
  const top = Math.max(0, (Math.min(start.y,end.y)-grid.y)/grid.scale);
  const right = Math.min(grid.width, (Math.max(start.x,end.x)-grid.x)/grid.scale);
  const bottom = Math.min(grid.height, (Math.max(start.y,end.y)-grid.y)/grid.scale);
  if (![left,top,right,bottom].every(Number.isFinite) || left >= right || top >= bottom) return null;
  return { x: left, y: top, width: right-left, height: bottom-top };
}

/** A straight piece of the fog's edge: [x1, y1, x2, y2] in fog-local coordinates. */
export type FogSegment = [number, number, number, number];

/**
 * Where covered fog meets revealed ground, merged into the longest straight runs. Edges along the
 * fog area's own border are left out: beyond them is no map, not revealed ground.
 */
export function fogBoundary(rects: FogRectangle[], bounds: { width: number; height: number }): FogSegment[] {
  if (!rects.length) return [];
  const xs = [...new Set(rects.flatMap(r => [r.x, r.x + r.width]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap(r => [r.y, r.y + r.height]))].sort((a, b) => a - b);
  const xIndex = new Map(xs.map((x, i) => [x, i])), yIndex = new Map(ys.map((y, i) => [y, i]));
  const cols = xs.length - 1, rows = ys.length - 1;
  // A 2D difference array marks covered cells in time linear in the cells, however large the rectangles.
  const marks = new Int32Array((cols + 1) * (rows + 1));
  for (const r of rects) {
    const x0 = xIndex.get(r.x)!, x1 = xIndex.get(r.x + r.width)!, y0 = yIndex.get(r.y)!, y1 = yIndex.get(r.y + r.height)!;
    marks[y0 * (cols + 1) + x0]++; marks[y0 * (cols + 1) + x1]--; marks[y1 * (cols + 1) + x0]--; marks[y1 * (cols + 1) + x1]++;
  }
  for (let row = 0; row <= rows; row++) for (let col = 1; col <= cols; col++) marks[row * (cols + 1) + col] += marks[row * (cols + 1) + col - 1];
  for (let row = 1; row <= rows; row++) for (let col = 0; col <= cols; col++) marks[row * (cols + 1) + col] += marks[(row - 1) * (cols + 1) + col];
  const covered = (col: number, row: number) => col >= 0 && row >= 0 && col < cols && row < rows && marks[row * (cols + 1) + col] > 0;

  const segments: FogSegment[] = [];
  for (let col = 0; col <= cols; col++) {
    if (xs[col] <= 0 || xs[col] >= bounds.width) continue;
    for (let row = 0; row < rows;) {
      if (covered(col - 1, row) === covered(col, row)) { row++; continue; }
      const start = row;
      while (row < rows && covered(col - 1, row) !== covered(col, row)) row++;
      segments.push([xs[col], ys[start], xs[col], ys[row]]);
    }
  }
  for (let row = 0; row <= rows; row++) {
    if (ys[row] <= 0 || ys[row] >= bounds.height) continue;
    for (let col = 0; col < cols;) {
      if (covered(col, row - 1) === covered(col, row)) { col++; continue; }
      const start = col;
      while (col < cols && covered(col, row - 1) !== covered(col, row)) col++;
      segments.push([xs[start], ys[row], xs[col], ys[row]]);
    }
  }
  return segments;
}
