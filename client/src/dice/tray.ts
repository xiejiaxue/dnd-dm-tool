/** Rectangular play-space bounds and physical tuning, shared by the renderer and checks. */
export interface SpaceBounds { halfWidth: number; halfDepth: number }
// One scene unit is 2 cm; time is seconds and mass is kilograms.
export const METERS_PER_UNIT = .02;
export const DICE_MOTION = {
  gravity: -9.80665 / METERS_PER_UNIT,
  releaseHeight: .20 / METERS_PER_UNIT,
  density: 940 * METERS_PER_UNIT ** 3,
  timeStep: 1 / 120,
  linearDamping: .02,
  angularDamping: .12,
  friction: .5,
  restitution: .45,
  floorFriction: .5,
  floorRestitution: .45,
  minRollTime: .3,
  quietTime: .25,
  cockedQuietTime: .6,
  linearThreshold: .05,
  angularThreshold: .1,
  timeout: 15,
} as const;

export function spaceBounds(width: number, height: number): SpaceBounds {
  const aspect = width / Math.max(1, height);
  return { halfWidth: 7, halfDepth: Math.max(4.4, Math.min(7, (15 / aspect - 1.8) / 2)) };
}
export function dieScale(_count: number): number { return 1; }
export function launchPosition(index: number, count: number, bounds: SpaceBounds): [number, number] {
  const columns = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(count * bounds.halfWidth / bounds.halfDepth))));
  const rows = Math.ceil(count / columns);
  const row = Math.floor(index / columns);
  const rowCount = Math.min(columns, count - row * columns);
  const stepX = Math.min(2.15, (bounds.halfWidth * 2 - 2.4) / Math.max(1, columns - 1));
  const stepZ = Math.min(2.15, (bounds.halfDepth * 2 - 2.4) / Math.max(1, rows - 1));
  return [(index % columns - (rowCount - 1) / 2) * stepX, (row - (rows - 1) / 2) * stepZ];
}
export function insideSpace(x: number, z: number, bounds: SpaceBounds, clearance = 0): boolean {
  return Math.abs(x) + clearance <= bounds.halfWidth + 1e-6 && Math.abs(z) + clearance <= bounds.halfDepth + 1e-6;
}
