import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Euler, Quaternion } from 'three';
import { DICE_MOTION as motion, DICE_THROW, METERS_PER_UNIT, spaceBounds, throwLaunches, type SpaceBounds } from '../dice/tray';
import { detectResult, makeDieGeometry } from '../dice/geometry';

beforeAll(async () => { await RAPIER.init(); });
function world(bounds?: SpaceBounds) {
  const world = new RAPIER.World({ x: 0, y: motion.gravity, z: 0 });
  world.timestep = motion.timeStep;
  world.numSolverIterations = 8;
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, .3, 20).setTranslation(0, -.3, 0)
    .setFriction(motion.floorFriction).setRestitution(motion.floorRestitution));
  if (bounds) for (const [hx, hz, x, z] of [
    [.16, bounds.halfDepth + .32, -bounds.halfWidth - .16, 0], [.16, bounds.halfDepth + .32, bounds.halfWidth + .16, 0],
    [bounds.halfWidth + .32, .16, 0, -bounds.halfDepth - .16], [bounds.halfWidth + .32, .16, 0, bounds.halfDepth + .16],
  ]) world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 7.2, hz).setTranslation(x, 6.6, z)
    .setFriction(motion.railFriction).setRestitution(motion.railRestitution));
  return world;
}
function seeded(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}
describe('physical tabletop dice', () => {
  it('falls from the 7 cm release in about 0.12 seconds and lands softly on felt with acetate mass', () => {
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
      // A flat landing on felt keeps e = 0.32: at most e² × 7 cm ≈ 0.7 cm, a little less after solver losses.
      expect(peak).toBeGreaterThan(.002); expect(peak).toBeLessThan(.01);
    } finally { w.free(); }
  });
  it.each([1, 6, 24])('throws %i mixed dice at the backstop and lets them settle inside the frame', count => {
    const bounds = spaceBounds(830, 430);
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
      let reachedBack = false;
      for (let t = 0; t < motion.timeout; t += motion.timeStep) {
        w.step();
        reachedBack ||= bodies.some(({ body }) => body.translation().z < -bounds.halfDepth + 1.4);
      }
      expect(reachedBack).toBe(true);
      for (const { body, shape } of bodies) {
        expect(body.isSleeping()).toBe(true);
        const { x, z } = body.translation();
        expect(Math.abs(x)).toBeLessThan(bounds.halfWidth);
        expect(Math.abs(z)).toBeLessThan(bounds.halfDepth);
        if (count === 1) expect(detectResult(shape, body.rotation()).alignment).toBeGreaterThan(.96);
      }
    } finally { w.free(); shapes.forEach(shape => shape.geometry.dispose()); }
  });
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
