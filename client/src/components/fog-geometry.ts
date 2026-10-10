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
