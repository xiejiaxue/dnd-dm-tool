import type { FogRect, Scene } from './types';

export const MAX_FOG_REVEAL_RECTS = 128;
const EPSILON = 0.001;

export function fogExtent(scene: Pick<Scene, 'mapImage' | 'mapSize' | 'playArea'>): { width: number; height: number } {
  return scene.mapImage
    ? { width: scene.mapSize[0], height: scene.mapSize[1] }
    : { width: scene.playArea.w, height: scene.playArea.h };
}

export function fogRectContains(outer: FogRect, inner: FogRect): boolean {
  return outer.x <= inner.x + EPSILON
    && outer.y <= inner.y + EPSILON
    && outer.x + outer.w >= inner.x + inner.w - EPSILON
    && outer.y + outer.h >= inner.y + inner.h - EPSILON;
}

/** Add one reveal without changing its union. Collinear/touching rectangles
 * are coalesced to keep long-running rooms compact. */
export function addFogReveal(rectangles: readonly FogRect[], value: FogRect): FogRect[] {
  let candidate = { ...value };
  const pending = rectangles.map(rect => ({ ...rect }));
  for (let index = 0; index < pending.length;) {
    const current = pending[index];
    if (fogRectContains(current, candidate)) return pending;
    if (fogRectContains(candidate, current)) {
      pending.splice(index, 1);
      continue;
    }
    const sameVerticalSpan = near(current.y, candidate.y) && near(current.h, candidate.h);
    const touchesHorizontally = current.x <= candidate.x + candidate.w + EPSILON
      && candidate.x <= current.x + current.w + EPSILON;
    if (sameVerticalSpan && touchesHorizontally) {
      const x = Math.min(current.x, candidate.x);
      candidate = { x, y: candidate.y, w: Math.max(current.x + current.w, candidate.x + candidate.w) - x, h: candidate.h };
      pending.splice(index, 1);
      index = 0;
      continue;
    }
    const sameHorizontalSpan = near(current.x, candidate.x) && near(current.w, candidate.w);
    const touchesVertically = current.y <= candidate.y + candidate.h + EPSILON
      && candidate.y <= current.y + current.h + EPSILON;
    if (sameHorizontalSpan && touchesVertically) {
      const y = Math.min(current.y, candidate.y);
      candidate = { x: candidate.x, y, w: candidate.w, h: Math.max(current.y + current.h, candidate.y + candidate.h) - y };
      pending.splice(index, 1);
      index = 0;
      continue;
    }
    index += 1;
  }
  return [...pending, candidate];
}

function near(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPSILON;
}
