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
