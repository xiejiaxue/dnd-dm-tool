import type { Token, Op } from '../types';
type Point = { x: number; y: number };
export function selectionRect(start: Point, end: Point) {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x-start.x), height: Math.abs(end.y-start.y) };
}
export function selectEnemies(tokens: Token[], start: Point, end: Point): string[] {
  const r = selectionRect(start, end);
  return tokens.filter(t => t.x >= r.x && t.x <= r.x+r.width && t.y >= r.y && t.y <= r.y+r.height).map(t => t.id);
}
export function visibilityBatches(tokens: Token[], ids: string[], hidden: boolean): Op[][] {
  const selected = new Set(ids);
  const ops: Op[] = tokens.filter(t => selected.has(t.id) && Boolean(t.hidden) !== hidden)
    .map(t => ({ op: 'updateToken', tokenId: t.id, patch: { hidden } }));
  const batches: Op[][] = [];
  for (let i=0; i<ops.length; i+=20) batches.push(ops.slice(i,i+20));
  return batches;
}
