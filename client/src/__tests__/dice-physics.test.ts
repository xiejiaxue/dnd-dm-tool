import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Euler, Quaternion } from 'three';
import { DICE_MOTION as motion, DICE_THROW, GUARD_TOP, METERS_PER_UNIT, RAIL_HEIGHT, RAIL_THICKNESS, insideSpace, spaceBounds, throwLaunches, wallSegments, type SpaceBounds, type TrayShape, type TraySize } from '../dice/tray';
import { detectResult, makeDieGeometry } from '../dice/geometry';

beforeAll(async () => { await RAPIER.init(); });
function world(bounds?: SpaceBounds) {
  const world = new RAPIER.World({ x: 0, y: motion.gravity, z: 0 });
  world.timestep = motion.timeStep;
  world.numSolverIterations = 8;
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, .3, 20).setTranslation(0, -.3, 0)
    .setFriction(motion.floorFriction).setRestitution(motion.floorRestitution));
  // Same rail colliders as the renderer: one box per outline edge, from below the felt up to the guard top.
  if (bounds) for (const wall of wallSegments(bounds)) world.createCollider(RAPIER.ColliderDesc
    .cuboid(wall.length / 2, (GUARD_TOP + .6) / 2, RAIL_THICKNESS / 2).setTranslation(wall.x, (GUARD_TOP - .6) / 2, wall.z)
    .setRotation({ x: 0, y: Math.sin(wall.angle / 2), z: 0, w: Math.cos(wall.angle / 2) })
    .setFriction(motion.railFriction).setRestitution(motion.railRestitution));
  return world;
}
function seeded(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}
/** A uniformly random orientation, as the renderer gives each die before the throw. */
function randomRotation(random: () => number) {
  const u = random(), v = random(), w = random();
  return new Quaternion(Math.sqrt(1 - u) * Math.sin(2 * Math.PI * v), Math.sqrt(1 - u) * Math.cos(2 * Math.PI * v),
    Math.sqrt(u) * Math.sin(2 * Math.PI * w), Math.sqrt(u) * Math.cos(2 * Math.PI * w));
}
/** Throws one die like the renderer and runs until it sleeps; reports where it rests and whether it reached the far rail. */
function throwOne(bounds: SpaceBounds, shape: ReturnType<typeof makeDieGeometry>, random: () => number) {
  const w = world(bounds);
  try {
    const [{ position: [x, y, z], velocity, spin }] = throwLaunches(1, bounds, random);
    const rotation = randomRotation(random);
    const support = -Math.min(...shape.vertices.map(v => v.clone().applyQuaternion(rotation).y));
    const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y + support, z).setRotation(rotation)
      .setLinvel(...velocity).setAngvel({ x: spin[0], y: spin[1], z: spin[2] })
      .setLinearDamping(motion.linearDamping).setAngularDamping(motion.angularDamping).setCcdEnabled(true));
    w.createCollider(RAPIER.ColliderDesc.convexHull(shape.points)!.setDensity(motion.density).setFriction(motion.friction)
      .setRestitution(motion.restitution).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min), body);
    // The rail across the tray from the hand is the one a hard throw would hit.
    let reachedBack = false;
    for (let t = 0; t < motion.timeout && !body.isSleeping(); t += motion.timeStep) {
      w.step();
      reachedBack ||= -Math.sign(x) * body.translation().x > bounds.halfWidth - 1.3;
    }
    const { x: restX, z: restZ } = body.translation();
    return { reachedBack, offCentre: Math.hypot(restX / bounds.halfWidth, restZ / bounds.halfDepth), result: detectResult(shape, body.rotation()) };
  } finally { w.free(); }
}
describe('physical tabletop dice', () => {
  it('falls from the 6 cm release in about 0.11 seconds and lands softly on felt with acetate mass', () => {
    const w = world();
    try {
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, DICE_THROW.releaseHeight + .6, 0).setCcdEnabled(true));
      w.createCollider(RAPIER.ColliderDesc.cuboid(.6, .6, .6).setDensity(motion.density).setRestitution(motion.restitution)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min).setFriction(motion.friction), body);
      w.step();
      expect(body.mass()).toBeCloseTo(1300 * .024 ** 3, 6);
      let impact = 0, peak = 0;
      for (let i = 1; i < 120; i++) {
        w.step();
        if (!impact && body.linvel().y > 0) impact = (i + 1) * motion.timeStep;
        if (impact) peak = Math.max(peak, (body.translation().y - .6) * METERS_PER_UNIT);
      }
      expect(impact).toBeGreaterThan(.1); expect(impact).toBeLessThan(.14);
      // A flat landing on felt keeps e = 0.32: at most e² × 6 cm ≈ 0.6 cm, a little less after solver losses.
      expect(peak).toBeGreaterThan(.002); expect(peak).toBeLessThan(.01);
    } finally { w.free(); }
  });
  it.each([
    [1, 'medium', 'square'], [6, 'medium', 'square'], [24, 'medium', 'square'],
    [6, 'medium', 'octagon'], [24, 'medium', 'octagon'], [24, 'small', 'octagon'], [12, 'large', 'octagon'],
  ] as [number, TraySize, TrayShape][])('throws %i mixed dice in a %s %s tray and lets them settle inside the frame', (count, size, shape) => {
    const bounds = spaceBounds(830, 430, size, shape, count);
    const w = world(bounds);
    const sides = [4, 6, 8, 10, 12, 20] as const;
    const shapes = sides.map(makeDieGeometry);
    try {
      const bodies = throwLaunches(count, bounds, seeded(count)).map(({ position: [x, y, z], velocity, spin }, i) => {
        const shape = shapes[i % 6];
        const rotation = new Quaternion().setFromEuler(new Euler(i * .73 + .31, i * .41, i * .97));
        const support = -Math.min(...shape.vertices.map(v => v.clone().applyQuaternion(rotation).y));
        const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y + support, z).setRotation(rotation)
          .setLinvel(...velocity).setAngvel({ x: spin[0], y: spin[1], z: spin[2] })
          .setLinearDamping(motion.linearDamping).setAngularDamping(motion.angularDamping).setCcdEnabled(true));
        w.createCollider(RAPIER.ColliderDesc.convexHull(shape.points)!.setDensity(motion.density).setFriction(motion.friction)
          .setRestitution(motion.restitution).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min), body);
        return { body, shape };
      });
      for (let t = 0; t < motion.timeout; t += motion.timeStep) w.step();
      for (const { body, shape } of bodies) {
        expect(body.isSleeping()).toBe(true);
        const { x, z } = body.translation();
        expect(insideSpace(x, z, bounds)).toBe(true);
        if (count === 1) expect(detectResult(shape, body.rotation()).alignment).toBeGreaterThan(.96);
      }
    } finally { w.free(); shapes.forEach(shape => shape.geometry.dispose()); }
  });
});

describe('a toss from the near rail', () => {
  it.each([[830, 430], [360, 420]])('releases the handful above a side rail and lobs it inwards (%i×%i)', (width, height) => {
    const sides = new Set<number>();
    for (const count of [1, 6, 24]) for (let seed = 0; seed < 20; seed++) {
      const bounds = spaceBounds(width, height, 'medium', 'octagon', count);
      const launches = throwLaunches(count, bounds, seeded(seed * 97 + count)), side = Math.sign(launches[0].position[0]);
      sides.add(side);
      for (const { position: [x, y, z], velocity: [across, up] } of launches) {
        expect(insideSpace(x, z, bounds, 1)).toBe(true);
        expect(y).toBeGreaterThan(RAIL_HEIGHT.high);
        expect(up).toBeGreaterThan(0);
        expect(side * across).toBeLessThan(0);
        if (count === 1) { expect(side * x).toBeGreaterThan(bounds.halfWidth / 2); expect(z).toBeGreaterThanOrEqual(0); }
      }
    }
    // Either hand: the entry rail is random.
    expect(sides).toEqual(new Set([-1, 1]));
  });
  it.each([[830, 430, 'octagon'], [360, 420, 'square']] as [number, number, TrayShape][])(
    'mostly brings a single die to rest near the middle instead of the far rail (%i×%i %s)', (width, height, shape) => {
      const bounds = spaceBounds(width, height, 'medium', shape, 1);
      const shapes = ([20, 6, 8, 12] as const).map(makeDieGeometry);
      try {
        const throws = Array.from({ length: 80 }, (_, i) => throwOne(bounds, shapes[i % shapes.length], seeded(i * 7919 + width)));
        const offCentre = throws.map(t => t.offCentre).sort((a, b) => a - b);
        // Distances are relative to the half-size of the frame: 1 is the rail.
        expect(offCentre[throws.length / 2]).toBeLessThan(.45);
        expect(offCentre.filter(d => d < .5).length / throws.length).toBeGreaterThan(.55);
        expect(throws.filter(t => t.reachedBack).length / throws.length).toBeLessThan(.15);
        // Still a spread rather than one fixed spot.
        expect(offCentre[Math.floor(throws.length * .9)]).toBeGreaterThan(.4);
      } finally { shapes.forEach(shape => shape.geometry.dispose()); }
    });
  it.each([6, 20] as const)('keeps every face of a d%i equally likely', sides => {
    const bounds = spaceBounds(830, 430, 'medium', 'octagon', 1), shape = makeDieGeometry(sides);
    try {
      const throws = sides * 40, counts = new Array(sides + 1).fill(0);
      for (let i = 0; i < throws; i++) {
        const { result } = throwOne(bounds, shape, seeded(i * 104729 + sides));
        if (result.alignment > .96) counts[result.value]++;
      }
      const read = counts.reduce((a, b) => a + b, 0), expected = read / sides;
      expect(read).toBeGreaterThan(throws * .98);
      const chiSquare = counts.slice(1).reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
      // 99.9th percentile of χ² with 5 and 19 degrees of freedom.
      expect(chiSquare).toBeLessThan(sides === 6 ? 20.5 : 43.8);
    } finally { shape.geometry.dispose(); }
  }, 60000);
});

import { isTabletopLanding } from '../dice/geometry';
describe('stacked and tilted dice', () => {
  it('rejects a sleeping, face-up die resting on another die', () => {
    const w = world();
    const shape = makeDieGeometry(6);
    try {
      const bodies = [.6, 1.8].map(y => {
        const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, y, 0));
        w.createCollider(RAPIER.ColliderDesc.cuboid(.6, .6, .6).setDensity(motion.density), body);
        return body;
      });
      for (let i = 0; i < 360; i++) w.step();
      expect(isTabletopLanding(shape, bodies[0].rotation(), bodies[0].translation().y)).toBe(true);
      expect(detectResult(shape, bodies[1].rotation()).alignment).toBeGreaterThan(.96);
      expect(isTabletopLanding(shape, bodies[1].rotation(), bodies[1].translation().y)).toBe(false);
    } finally { w.free(); shape.geometry.dispose(); }
  });
  it.each([4,6,8,10,12,20] as const)('recognizes real tabletop contact for d%i independently of orientation', sides => {
    const shape = makeDieGeometry(sides);
    try {
      const rotation = new Quaternion().setFromEuler(new Euler(.5, .8, 1.2));
      const support = -Math.min(...shape.vertices.map(v => v.clone().applyQuaternion(rotation).y));
      expect(isTabletopLanding(shape, rotation, support)).toBe(true);
      expect(isTabletopLanding(shape, rotation, support + 1)).toBe(false);
    } finally { shape.geometry.dispose(); }
  });
});
