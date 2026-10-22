/** Rectangular play-space bounds and physical tuning, shared by the renderer and checks. */
export interface SpaceBounds { halfWidth: number; halfDepth: number; chamfer: number }
// One scene unit is 2 cm; time is seconds and mass is kilograms.
export const METERS_PER_UNIT = .02;
const mps = (metersPerSecond: number) => metersPerSecond / METERS_PER_UNIT;
export const DICE_MOTION = {
  gravity: -9.80665 / METERS_PER_UNIT,
  // Cellulose acetate, the material of casino dice (about 1.30 g/cm³).
  density: 1300 * METERS_PER_UNIT ** 3,
  timeStep: 1 / 120,
  // Air drag is negligible; the angular term stands in for felt rolling resistance.
  linearDamping: .01,
  angularDamping: .12,
  // Die colliders use Min restitution, so each surface below sets its own bounce.
  // Friction averages per contact: about .2 die on die, .4 on felt and .25 on the rail.
  friction: .2,
  restitution: .6,
  // Baize over a foam pad: soft landing, enough grip to turn sliding into tumbling.
  floorFriction: .6,
  floorRestitution: .32,
  // Rubber backstop rail: livelier rebound, little grip, so dice glance off instead of climbing.
  railFriction: .3,
  railRestitution: .65,
  minRollTime: .3,
  quietTime: .25,
  cockedQuietTime: .6,
  linearThreshold: .05,
  angularThreshold: .1,
  timeout: 15,
} as const;
/** A one-handed underhand toss from the near rail towards the backstop. */
export const DICE_THROW = {
  releaseHeight: .07 / METERS_PER_UNIT,
  spacing: 2.15,
  maxColumns: 6,
  maxRows: 4,
  speed: [mps(.65), mps(.95)] as const,
  loft: mps(.25),
  aim: .22,
  tumble: [12, 22] as const,
  wobble: 8,
  jitter: .18,
  crowd: 16,
} as const;

export type TraySize = 'small' | 'medium' | 'large';
export type TrayShape = 'square' | 'octagon';
const SIZE_SCALE: Record<TraySize, number> = { small: .82, medium: 1, large: 1.22 };
/** Height of the visible rail; an invisible guard continues above it so dice never leave the tray. */
export const RAIL_HEIGHT = { low: .9, high: 1.7 } as const;
export const RAIL_THICKNESS = .32;
export const GUARD_TOP = 13.8;

// Felt per die below which a full handful tends to land stacked instead of flat.
const AREA_PER_DIE = 5.4;
/** A small tray grows for a big handful, so `count` dice still have room to land flat. */
export function spaceBounds(width: number, height: number, size: TraySize = 'medium', shape: TrayShape = 'square', count = 0): SpaceBounds {
  const aspect = width / Math.max(1, height), chamferRatio = shape === 'octagon' ? .32 : 0;
  const halfWidth = 7, halfDepth = Math.max(4.4, Math.min(7, (15 / aspect - 1.8) / 2));
  const area = 4 * halfWidth * halfDepth - 2 * (chamferRatio * Math.min(halfWidth, halfDepth)) ** 2;
  const scale = Math.max(SIZE_SCALE[size], Math.sqrt(count * AREA_PER_DIE / area));
  return { halfWidth: halfWidth * scale, halfDepth: halfDepth * scale, chamfer: chamferRatio * Math.min(halfWidth, halfDepth) * scale };
}
/** The inner edge of the rail, counter-clockwise seen from above (+y). */
export function trayOutline(bounds: SpaceBounds): [number, number][] {
  const { halfWidth: w, halfDepth: d, chamfer: c } = bounds;
  if (c <= 0) return [[-w, d], [w, d], [w, -d], [-w, -d]];
  return [[-w + c, d], [w - c, d], [w, d - c], [w, -d + c], [w - c, -d], [-w + c, -d], [-w, -d + c], [-w, d - c]];
}
export interface WallSegment { x: number; z: number; length: number; angle: number }
/**
 * One rail box per outline edge, pushed outwards by half its thickness. Each box is lengthened by
 * thickness × tan(turn / 2) at both ends so neighbouring outer faces meet exactly at the corner.
 * `angle` is the rotation about +y that maps the box's local x axis onto the edge.
 */
export function wallSegments(bounds: SpaceBounds, thickness = RAIL_THICKNESS): WallSegment[] {
  const outline = trayOutline(bounds), n = outline.length;
  const direction = (i: number) => {
    const [ax, az] = outline[(i + n) % n], [bx, bz] = outline[(i + 1 + n) % n], length = Math.hypot(bx - ax, bz - az);
    return { dx: (bx - ax) / length, dz: (bz - az) / length, length };
  };
  const extension = (a: ReturnType<typeof direction>, b: ReturnType<typeof direction>) =>
    thickness * Math.tan(Math.acos(Math.max(-1, Math.min(1, a.dx * b.dx + a.dz * b.dz))) / 2);
  return outline.map(([ax, az], i) => {
    const edge = direction(i), before = extension(direction(i - 1), edge), after = extension(edge, direction(i + 1));
    // Counter-clockwise from above, the outward normal is the edge direction turned right.
    const nx = -edge.dz, nz = edge.dx;
    const along = (after - before) / 2;
    return {
      x: ax + edge.dx * (edge.length / 2 + along) + nx * thickness / 2,
      z: az + edge.dz * (edge.length / 2 + along) + nz * thickness / 2,
      length: edge.length + before + after,
      angle: Math.atan2(-edge.dz, edge.dx),
    };
  });
}
export function dieScale(_count: number): number { return 1; }
export type Vec3 = [number, number, number];
export interface DieLaunch { position: Vec3; velocity: Vec3; spin: Vec3 }
/**
 * Dice leave the hand as one loose cluster near the front rail (+z) and share the hand's motion,
 * each with a little jitter so they separate. `position[1]` is the height of the die's lowest point.
 */
export function throwLaunches(count: number, bounds: SpaceBounds, random: () => number): DieLaunch[] {
  const t = DICE_THROW, s = t.spacing, edge = 1.2;
  // A chamfered corner cuts the rectangle along |x| + |z| = halfWidth + halfDepth - chamfer.
  const diagonal = bounds.chamfer > 0 ? bounds.halfWidth + bounds.halfDepth - bounds.chamfer - edge * Math.SQRT2 : Infinity;
  const columns = Math.max(1, Math.min(t.maxColumns, count, Math.floor(2 * (bounds.halfWidth - edge) / s) + 1));
  const spread = (columns - 1) * s / 2;
  // Furthest |z| a full row may reach without its outer dice touching a rail.
  const reach = Math.max(0, Math.min(bounds.halfDepth - edge, diagonal - spread));
  const frontZ = Math.min(bounds.halfDepth - 1.4, reach);
  // Rows that fit between the front rail and the back rail; any remainder is held one layer up.
  const fitRows = Math.max(1, Math.floor((frontZ + reach) / s) + 1);
  const rows = Math.min(t.maxRows, fitRows, Math.ceil(count / columns));
  // A big handful is pushed out more gently, so the pool spreads over the felt instead of piling on the rail.
  const crowd = 1 / (1 + (count - 1) / t.crowd);
  const perLayer = columns * rows;
  const widest = Math.max(Math.abs(frontZ), Math.abs(frontZ - (rows - 1) * s));
  const lateral = Math.max(0, Math.min(bounds.halfWidth - edge, diagonal - widest) - spread);
  const handX = (random() * 2 - 1) * lateral * .6;
  const angle = (random() * 2 - 1) * t.aim - handX / bounds.halfWidth * t.aim;
  const speed = (t.speed[0] + random() * (t.speed[1] - t.speed[0])) * crowd;
  const tumble = t.tumble[0] + random() * (t.tumble[1] - t.tumble[0]);
  const vary = () => 1 + (random() * 2 - 1) * t.jitter;
  return Array.from({ length: count }, (_, i) => {
    const layer = Math.floor(i / perLayer), slot = i % perLayer;
    const row = Math.floor(slot / columns), column = slot % columns;
    const x = handX + column * s - spread, z = frontZ - row * s;
    const v = speed * vary(), heading = angle + (random() * 2 - 1) * .06;
    // Rolling towards -z on the table is a negative spin about x.
    return {
      position: [x, t.releaseHeight + layer * s, z],
      velocity: [Math.sin(heading) * v, t.loft * vary(), -Math.cos(heading) * v],
      spin: [-tumble * vary() + (random() * 2 - 1) * t.wobble, (random() * 2 - 1) * t.wobble, (random() * 2 - 1) * t.wobble],
    };
  });
}
export function insideSpace(x: number, z: number, bounds: SpaceBounds, clearance = 0): boolean {
  return Math.abs(x) + clearance <= bounds.halfWidth + 1e-6 && Math.abs(z) + clearance <= bounds.halfDepth + 1e-6
    && Math.abs(x) + Math.abs(z) + clearance * Math.SQRT2 <= bounds.halfWidth + bounds.halfDepth - bounds.chamfer + 1e-6;
}
