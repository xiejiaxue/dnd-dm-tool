import { describe, expect, it } from 'vitest';
import { boundsOf, clampZoom, easeInOut, interpolateView, viewCenteredOn, viewForRect, wheelZoomFactor, zoomAroundPoint } from '../components/board-zoom';

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

describe('camera flights and quick locate', () => {
  const viewport = { width: 800, height: 600 };
  it('fits a board rectangle in the middle of the viewport', () => {
    const view = viewForRect({ x: 1000, y: 500, width: 400, height: 200 }, viewport, 50);
    expect(view.scale).toBeCloseTo(1.75);
    expect((400 - view.pos.x) / view.scale).toBeCloseTo(1200);
    expect((300 - view.pos.y) / view.scale).toBeCloseTo(600);
    expect(viewForRect({ x: 0, y: 0, width: 10, height: 10 }, viewport, 50, 2).scale).toBe(2);
  });
  it('frames a lone point with at least the minimum span', () => {
    expect(boundsOf([], 10, 100)).toBeNull();
    expect(boundsOf([{ x: 50, y: 50 }], 10, 100)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(boundsOf([{ x: 0, y: 0 }, { x: 300, y: 100 }], 10, 100)).toEqual({ x: -10, y: -10, width: 320, height: 120 });
  });
  it('flies along a straight path with geometric zoom and lands exactly', () => {
    const from = viewCenteredOn({ x: 0, y: 0 }, viewport, 1), to = viewCenteredOn({ x: 1000, y: 400 }, viewport, 4);
    const middle = interpolateView(from, to, viewport, 0.5);
    expect(middle.scale).toBeCloseTo(2);
    expect((400 - middle.pos.x) / middle.scale).toBeCloseTo(500);
    expect((300 - middle.pos.y) / middle.scale).toBeCloseTo(200);
    const end = interpolateView(from, to, viewport, 1);
    expect(end.scale).toBeCloseTo(4); expect(end.pos.x).toBeCloseTo(to.pos.x); expect(end.pos.y).toBeCloseTo(to.pos.y);
    expect(easeInOut(0)).toBe(0); expect(easeInOut(1)).toBe(1); expect(easeInOut(0.5)).toBeCloseTo(0.5);
  });
});
