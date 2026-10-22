/** Rectangular play-space bounds and physical tuning, shared by the renderer and checks. */
export interface SpaceBounds { halfWidth: number; halfDepth: number }
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

export function spaceBounds(width: number, height: number): SpaceBounds {
  const aspect = width / Math.max(1, height);
  return { halfWidth: 7, halfDepth: Math.max(4.4, Math.min(7, (15 / aspect - 1.8) / 2)) };
}
export function dieScale(_count: number): number { return 1; }
export type Vec3 = [number, number, number];
export interface DieLaunch { position: Vec3; velocity: Vec3; spin: Vec3 }
/**
 * Dice leave the hand as one loose cluster near the front rail (+z) and share the hand's motion,
 * each with a little jitter so they separate. `position[1]` is the height of the die's lowest point.
 */
export function throwLaunches(count: number, bounds: SpaceBounds, random: () => number): DieLaunch[] {
  const t = DICE_THROW, s = t.spacing;
  const frontZ = bounds.halfDepth - 1.4;
  // Rows that fit between the front rail and the back rail; any remainder is held one layer up.
  const fitRows = Math.floor((frontZ + bounds.halfDepth - 1.2) / s) + 1;
  const columns = Math.min(t.maxColumns, count), rows = Math.min(t.maxRows, fitRows, Math.ceil(count / columns));
  // A big handful is pushed out more gently, so the pool spreads over the felt instead of piling on the rail.
  const crowd = 1 / (1 + (count - 1) / t.crowd);
  const perLayer = columns * rows;
  const spread = (columns - 1) * s / 2;
  const lateral = Math.max(0, bounds.halfWidth - 1.2 - spread);
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
  return Math.abs(x) + clearance <= bounds.halfWidth + 1e-6 && Math.abs(z) + clearance <= bounds.halfDepth + 1e-6;
}
