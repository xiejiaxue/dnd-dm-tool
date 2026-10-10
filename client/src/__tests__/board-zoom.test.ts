import { describe, expect, it } from 'vitest';
import { clampZoom, wheelZoomFactor, zoomAroundPoint } from '../components/board-zoom';

describe('battle viewport zoom', () => {
  it('keeps the world point at the viewport centre stationary', () => {
    const anchor = { x: 400, y: 300 }, pos = { x: 50, y: -20 };
    const next = zoomAroundPoint(1.25, pos, anchor, 2.73);
    expect((anchor.x - next.pos.x) / next.scale).toBeCloseTo((anchor.x - pos.x) / 1.25);
    expect((anchor.y - next.pos.y) / next.scale).toBeCloseTo((anchor.y - pos.y) / 1.25);
  });
  it('supports pointer anchored zoom at both bounds', () => {
    const anchor = { x: 90, y: 160 };
    for (const target of [-1, 100]) {
      const next = zoomAroundPoint(2, { x: 20, y: 40 }, anchor, target);
      expect(next.scale).toBe(target < 0 ? 0.1 : 8);
      expect((anchor.x - next.pos.x) / next.scale).toBeCloseTo(35);
      expect((anchor.y - next.pos.y) / next.scale).toBeCloseTo(60);
    }
  });
  it('uses wheel distance instead of jumping ten percent for every trackpad event', () => {
    expect(wheelZoomFactor(0, 0, 800)).toBe(1);
    expect(wheelZoomFactor(1, 0, 800)).toBeGreaterThan(0.99);
    expect(wheelZoomFactor(100, 0, 800)).toBeLessThan(wheelZoomFactor(1, 0, 800));
    expect(wheelZoomFactor(100, 0, 800) * wheelZoomFactor(-100, 0, 800)).toBeCloseTo(1);
    expect(wheelZoomFactor(1, 1, 800)).toBe(wheelZoomFactor(16, 0, 800));
    expect(wheelZoomFactor(1, 2, 400)).toBe(wheelZoomFactor(400, 0, 400));
    expect(clampZoom(NaN)).toBe(1);
  });
});
