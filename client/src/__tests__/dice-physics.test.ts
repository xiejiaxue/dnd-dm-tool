import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Euler, Quaternion } from 'three';
import { DICE_MOTION as motion, METERS_PER_UNIT, launchPosition, spaceBounds } from '../dice/tray';
import { detectResult, makeDieGeometry } from '../dice/geometry';

beforeAll(async () => { await RAPIER.init(); });
function world() {
  const world = new RAPIER.World({ x: 0, y: motion.gravity, z: 0 });
  world.timestep = motion.timeStep;
  world.numSolverIterations = 8;
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, .3, 20).setTranslation(0, -.3, 0)
    .setFriction(motion.floorFriction).setRestitution(motion.floorRestitution));
  return world;
}
describe('physical tabletop dice', () => {
  it('drops 20 cm in about 0.20 seconds and rebounds softly with correct wood mass', () => {
    const w = world();
    try {
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, motion.releaseHeight + .6, 0).setCcdEnabled(true));
      w.createCollider(RAPIER.ColliderDesc.cuboid(.6, .6, .6).setDensity(motion.density).setRestitution(motion.restitution)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min).setFriction(motion.friction), body);
      w.step();
      expect(body.mass()).toBeCloseTo(940 * .024 ** 3, 6);
      let impact = 0, peak = 0;
      for (let i = 1; i < 120; i++) {
        w.step();
        if (!impact && body.linvel().y > 0) impact = (i + 1) * motion.timeStep;
        if (impact) peak = Math.max(peak, (body.translation().y - .6) * METERS_PER_UNIT);
      }
      expect(impact).toBeGreaterThan(.18); expect(impact).toBeLessThan(.23);
      expect(peak).toBeGreaterThan(.02); expect(peak).toBeLessThan(.065);
    } finally { w.free(); }
  });
  it.each([1, 6, 24])('settles a mixed pool of %i dice without artificial relaunches', count => {
    const w = world();
    const sides = [4, 6, 8, 10, 12, 20] as const;
    const shapes = sides.map(makeDieGeometry);
    try {
      const bounds = spaceBounds(830, 430);
      const bodies = Array.from({ length: count }, (_, i) => {
        const shape = shapes[i % 6];
        const rotation = new Quaternion().setFromEuler(new Euler(i * .73 + .31, i * .41, i * .97));
        const support = -Math.min(...shape.vertices.map(v => v.clone().applyQuaternion(rotation).y));
        const [x, z] = launchPosition(i, count, bounds);
        const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, motion.releaseHeight + support, z)
          .setRotation(rotation).setLinvel((i % 3 - 1) * 2, 0, (i % 2 - .5) * 2).setAngvel({ x: 3, y: -2, z: 4 })
          .setLinearDamping(motion.linearDamping).setAngularDamping(motion.angularDamping).setCcdEnabled(true));
        w.createCollider(RAPIER.ColliderDesc.convexHull(shape.points)!.setDensity(motion.density)
          .setFriction(motion.friction).setRestitution(motion.restitution), body);
        return { body, shape };
      });
      for (let t = 0; t < motion.timeout; t += motion.timeStep) w.step();
      for (const { body, shape } of bodies) {
        expect(body.isSleeping()).toBe(true);
        expect(detectResult(shape, body.rotation()).alignment).toBeGreaterThan(.96);
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
