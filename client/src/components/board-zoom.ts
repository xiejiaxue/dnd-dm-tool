export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(value) ? value : 1));
}

/** Keep the same world coordinate under the pointer or viewport centre. */
export function zoomAroundPoint(scale: number, pos: { x: number; y: number }, anchor: { x: number; y: number }, next: number) {
  const nextScale = clampZoom(next);
  return { scale: nextScale, pos: { x: anchor.x - (anchor.x - pos.x) / scale * nextScale, y: anchor.y - (anchor.y - pos.y) / scale * nextScale } };
}

export function wheelZoomFactor(delta: number, mode: number, viewportHeight: number) {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? viewportHeight : 1);
  return Math.exp(-Math.max(-500, Math.min(500, pixels)) * 0.0015);
}

export type View = { scale: number; pos: { x: number; y: number } };
export type Viewport = { width: number; height: number };
export type BoardRect = { x: number; y: number; width: number; height: number };

/** The view that fits a board rectangle inside the viewport with `padding` screen pixels around it. */
export function viewForRect(rect: BoardRect, viewport: Viewport, padding = 48, maxScale = MAX_ZOOM): View {
  const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
  const room = { width: Math.max(1, viewport.width - padding * 2), height: Math.max(1, viewport.height - padding * 2) };
  const scale = clampZoom(Math.min(maxScale, room.width / width, room.height / height));
  return viewCenteredOn({ x: rect.x + width / 2, y: rect.y + height / 2 }, viewport, scale);
}

/** The view at `scale` with a board point in the middle of the viewport. */
export function viewCenteredOn(point: { x: number; y: number }, viewport: Viewport, scale: number): View {
  return { scale, pos: { x: viewport.width / 2 - point.x * scale, y: viewport.height / 2 - point.y * scale } };
}

/** Board rectangle around the given points, grown to at least `minSize` on each side (centred). */
export function boundsOf(points: readonly { x: number; y: number }[], margin: number, minSize: number): BoardRect | null {
  if (!points.length) return null;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const left = Math.min(...xs) - margin, top = Math.min(...ys) - margin;
  const width = Math.max(...xs) + margin - left, height = Math.max(...ys) + margin - top;
  const w = Math.max(minSize, width), h = Math.max(minSize, height);
  return { x: left - (w - width) / 2, y: top - (h - height) / 2, width: w, height: h };
}

export const easeInOut = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * A point along a camera flight from one view to another: the board point at the viewport centre
 * moves in a straight line while the zoom changes geometrically, which reads as one smooth move.
 */
export function interpolateView(from: View, to: View, viewport: Viewport, t: number): View {
  const center = (view: View) => ({ x: (viewport.width / 2 - view.pos.x) / view.scale, y: (viewport.height / 2 - view.pos.y) / view.scale });
  const a = center(from), b = center(to);
  const scale = from.scale * Math.pow(to.scale / from.scale, t);
  return viewCenteredOn({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, viewport, scale);
}
