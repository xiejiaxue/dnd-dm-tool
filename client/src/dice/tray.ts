/** Rectangular play-space bounds and physical tuning, shared by the renderer and checks. */
export interface SpaceBounds { halfWidth: number; halfDepth: number; chamfer: number }
// One scene unit is 2 cm; time is seconds and mass is kilograms.
export const METERS_PER_UNIT = .02;
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
/**
 * A one-handed lob from the left or right rail, on the thrower's (+z) half: the dice clear the rail, arc
 * across the felt and touch down short of the centre, so their tumble carries them to rest around the middle
 * instead of the far rail. Coming in sideways keeps the flight readable from every camera angle.
 */
export const DICE_THROW = {
  // Lowest point at release, just above the 3.4 cm high rail.
  releaseHeight: .045 / METERS_PER_UNIT,
  // How far the hand stays inside the rail.
  inset: 1.3,
  spacing: 2.15,
  maxColumns: 4,
  maxRows: 3,
  // Where along the side rail the hand comes in, as a share of halfDepth towards the thrower.
  entry: [.2, .6] as const,
  // Rise above the release point before the dice fall.
  apex: [.015 / METERS_PER_UNIT, .04 / METERS_PER_UNIT] as const,
  // First touchdown, as a share of halfWidth on the entry side of the centre.
  landing: [.05, .35] as const,
  // Share of the hand's offset along the rail the toss takes back towards the middle, and random scatter.
  drift: .6,
  scatter: .12,
  // Extra landing spacing per additional die.
  fan: .02,
  tumble: [12, 22] as const,
  wobble: 8,
  jitter: .18,
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
 * Dice leave the hand as one loose cluster just inside a side rail, above its top, and share the hand's
 * parabola: the velocity is solved so the cluster's centre touches down at a random spot short of the middle.
 * Each die gets a little jitter so they separate. `position[1]` is the height of the die's lowest point.
 */
export function throwLaunches(count: number, bounds: SpaceBounds, random: () => number): DieLaunch[] {
  const t = DICE_THROW, s = t.spacing, g = -DICE_MOTION.gravity;
  const between = (range: readonly [number, number]) => range[0] + random() * (range[1] - range[0]);
  // Work in the throw's frame: `in` runs from the entry rail towards the centre, `along` follows that rail.
  const side = random() < .5 ? -1 : 1;
  // A chamfered corner cuts the rectangle along |x| + |z| = halfWidth + halfDepth - chamfer.
  const diagonal = bounds.chamfer > 0 ? bounds.halfWidth + bounds.halfDepth - bounds.chamfer - t.inset * Math.SQRT2 : Infinity;
  const startIn = bounds.halfWidth - t.inset, reach = Math.min(bounds.halfDepth - t.inset, diagonal - startIn);
  // A compact handful: a few dice along the rail, a few deep, the rest held one layer up.
  const columns = Math.max(1, Math.min(t.maxColumns, Math.ceil(Math.sqrt(count)), Math.floor(2 * reach / s) + 1));
  const rows = Math.max(1, Math.min(t.maxRows, Math.ceil(count / columns), Math.floor(startIn / s) + 1));
  const perLayer = columns * rows, layers = Math.ceil(count / perLayer), spread = (columns - 1) * s / 2;
  const room = Math.max(0, reach - spread), hand = Math.min(room, between(t.entry) * bounds.halfDepth);
  // Solve the lob: rise `apex` above the release, then fall to the felt at the chosen landing spot.
  const rise = Math.sqrt(2 * g * between(t.apex));
  const flight = (rise + Math.sqrt(rise * rise + 2 * g * t.releaseHeight)) / g;
  const landIn = between(t.landing) * bounds.halfWidth;
  const landAlong = hand * (1 - t.drift) + (random() * 2 - 1) * t.scatter * bounds.halfDepth;
  // A big handful opens up in the air so it lands spread over the felt rather than in one heap.
  const fan = 1 + (count - 1) * t.fan;
  // The dice roll forward along the toss: the spin axis is the horizontal heading turned a quarter right.
  const heading = Math.hypot(landIn - startIn, landAlong - hand), tumble = between(t.tumble);
  const toWorld = (inward: number, along: number): [number, number] => [side * inward, along];
  const [dx, dz] = toWorld((landIn - startIn) / heading, (landAlong - hand) / heading);
  const vary = () => 1 + (random() * 2 - 1) * t.jitter;
  return Array.from({ length: count }, (_, i) => {
    const layer = Math.floor(i / perLayer), slot = i % perLayer;
    const row = Math.floor(slot / columns), column = slot % columns;
    const inward = startIn - row * s, along = hand + column * s - spread;
    const targetAlong = landAlong + (along - hand) * fan;
    const targetIn = Math.min(inward - s / 2, landIn + ((rows * layers - 1) / 2 - row - layer * rows) * s * fan);
    const [x, z] = toWorld(inward, along), [vx, vz] = toWorld((targetIn - inward) / flight, (targetAlong - along) / flight);
    const v = vary(), roll = tumble * vary(), wobble = () => (random() * 2 - 1) * t.wobble;
    return {
      position: [x, t.releaseHeight + layer * s, z],
      velocity: [vx * v, rise * vary(), vz * v],
      spin: [dz * roll + wobble(), wobble(), -dx * roll + wobble()],
    };
  });
}
export function insideSpace(x: number, z: number, bounds: SpaceBounds, clearance = 0): boolean {
  return Math.abs(x) + clearance <= bounds.halfWidth + 1e-6 && Math.abs(z) + clearance <= bounds.halfDepth + 1e-6
    && Math.abs(x) + Math.abs(z) + clearance * Math.SQRT2 <= bounds.halfWidth + bounds.halfDepth - bounds.chamfer + 1e-6;
}
