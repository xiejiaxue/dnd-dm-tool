import type { PlayArea } from './types';

export const FOG_CELL = 50;
export interface FogScene {
  mapImage: string | null;
  mapSize: [number, number];
  mapScale?: number;
  playArea: PlayArea;
  fog?: boolean[];
  fogBasisScale?: number;
  fogReveals?: FogRectangle[];
}

function dimensions(scene: FogScene, basis: number) {
  const width = scene.mapImage ? scene.mapSize[0] : scene.playArea.w;
  const height = scene.mapImage ? scene.mapSize[1] : scene.playArea.h;
  return { cols: Math.ceil(width * basis / FOG_CELL), rows: Math.ceil(height * basis / FOG_CELL) };
}

/** Frozen raster density in image coordinates. Never follows later map zoom. */
export function resolveFogBasisScale(scene: FogScene): number {
  if (!scene.mapImage) return 1;
  if (scene.fogBasisScale !== undefined && Number.isFinite(scene.fogBasisScale) && scene.fogBasisScale >= 0.1 && scene.fogBasisScale <= 8) return scene.fogBasisScale;
  const length = scene.fog?.length ?? 0;
  if (!length) return 1;
  // Legacy saves did not record their stride. Prefer the currently valid
  // raster, then the original 100% raster; neither reorders or resamples bits.
  const current = Math.min(8, Math.max(0.1, scene.mapScale ?? 1));
  for (const scale of [current, 1]) {
    const grid = dimensions(scene, scale);
    if (grid.cols * grid.rows === length) return scale;
  }
  // If the old zoom already changed the stride, recover a feasible grid from
  // the stored length and map aspect. Exact historical sub-cell scale is not
  // present in those saves; freeze this reconstruction once at load time.
  const [w, h] = scene.mapSize;
  let best: { scale: number; distance: number } | undefined;
  const consider = (cols: number, rows: number) => {
    const low = Math.max(0.1, (cols - 1) * FOG_CELL / w, (rows - 1) * FOG_CELL / h);
    const high = Math.min(8, cols * FOG_CELL / w, rows * FOG_CELL / h);
    if (high <= low) return;
    const scale = Math.max(low + (high - low) * 0.001, Math.min(high, current));
    const grid = dimensions(scene, scale);
    if (grid.cols !== cols || grid.rows !== rows) return;
    const distance = Math.abs(Math.log(scale / current));
    if (!best || distance < best.distance) best = { scale, distance };
  };
  for (let divisor = 1; divisor * divisor <= length; divisor++) {
    if (length % divisor) continue;
    consider(divisor, length / divisor);
    consider(length / divisor, divisor);
  }
  return best?.scale ?? current;
}

export function fogGridSize(scene: FogScene) {
  return dimensions(scene, resolveFogBasisScale(scene));
}

export function fogGeometry(scene: FogScene, displayScale = scene.mapScale ?? 1) {
  const basis = resolveFogBasisScale(scene);
  return {
    ...dimensions(scene, basis), basis,
    x: scene.mapImage ? 0 : scene.playArea.x,
    y: scene.mapImage ? 0 : scene.playArea.y,
    width: scene.mapImage ? scene.mapSize[0] : scene.playArea.w,
    height: scene.mapImage ? scene.mapSize[1] : scene.playArea.h,
    scale: scene.mapImage ? displayScale : 1,
    cellSize: FOG_CELL / basis,
  };
}

/** Exact revealed regions, in unscaled image coordinates (or play-area local coordinates). */
export interface FogRectangle { x: number; y: number; width: number; height: number }

export function clipFogRectangle(scene: FogScene, rect: FogRectangle): FogRectangle | null {
  if (!Object.values(rect).every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
  const grid = fogGeometry(scene);
  const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
  const right = Math.min(grid.width, rect.x + rect.width), bottom = Math.min(grid.height, rect.y + rect.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** Disjoint pieces of base left after cutting out the exact intersection. */
export function subtractFogRectangle(base: FogRectangle, cut: FogRectangle): FogRectangle[] {
  const x = Math.max(base.x, cut.x), y = Math.max(base.y, cut.y);
  const right = Math.min(base.x + base.width, cut.x + cut.width);
  const bottom = Math.min(base.y + base.height, cut.y + cut.height);
  if (right <= x || bottom <= y) return [base];
  return [
    { x: base.x, y: base.y, width: base.width, height: y - base.y },
    { x: base.x, y: bottom, width: base.width, height: base.y + base.height - bottom },
    { x: base.x, y, width: x - base.x, height: bottom - y },
    { x: right, y, width: base.x + base.width - right, height: bottom - y },
  ].filter(rect => rect.width > 0 && rect.height > 0);
}

export function revealFogRectangle(scene: FogScene, rect: FogRectangle): FogRectangle[] | undefined {
  const clipped = clipFogRectangle(scene, rect);
  if (!clipped) return scene.fogReveals;
  const contains = (a: FogRectangle, b: FogRectangle) => a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height;
  const regions = scene.fogReveals ?? [];
  if (regions.some(region => contains(region, clipped))) return scene.fogReveals;
  return [...regions.filter(region => !contains(clipped, region)), clipped];
}

/** Cover-cell operations must also cover any exact reveals inside those cells. */
export function coverFogRectangles(scene: FogScene, cells: number[]): FogRectangle[] | undefined {
  if (!scene.fogReveals?.length) return scene.fogReveals;
  const grid = fogGeometry(scene);
  let regions = scene.fogReveals;
  for (const cell of new Set(cells)) {
    if (cell < 0 || cell >= grid.cols * grid.rows) continue;
    const cut = { x: cell % grid.cols * grid.cellSize, y: Math.floor(cell / grid.cols) * grid.cellSize, width: grid.cellSize, height: grid.cellSize };
    regions = regions.flatMap(region => subtractFogRectangle(region, cut));
  }
  return regions.length ? regions : undefined;
}
