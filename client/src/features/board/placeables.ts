import type { MapNote } from '../../types';

export type PlaceableKind = 'token' | 'wall' | 'note';
export interface PlaceableRef { kind: PlaceableKind; id: string }

export const placeableKey = (ref: PlaceableRef): string => `${ref.kind}:${ref.id}`;

export function selectPlaceable(current: readonly PlaceableRef[], next: PlaceableRef, additive: boolean): PlaceableRef[] {
  if (!additive) return [next];
  const key = placeableKey(next);
  return current.some(ref => placeableKey(ref) === key)
    ? current.filter(ref => placeableKey(ref) !== key)
    : [...current, next];
}

export function mergePlaceables(current: readonly PlaceableRef[], inside: readonly PlaceableRef[], additive: boolean): PlaceableRef[] {
  if (!additive) return [...inside];
  const unique = new Map(current.map(ref => [placeableKey(ref), ref]));
  for (const ref of inside) unique.set(placeableKey(ref), ref);
  return [...unique.values()];
}

export function isPlaceableSelected(selected: readonly PlaceableRef[], kind: PlaceableKind, id: string): boolean {
  return selected.some(ref => ref.kind === kind && ref.id === id);
}

export function notesInsideRect(notes: readonly MapNote[], rect: { x: number; y: number; w: number; h: number }): PlaceableRef[] {
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  return notes.flatMap(note => note.x >= rect.x && note.x <= right && note.y >= rect.y && note.y <= bottom
    ? [{ kind: 'note' as const, id: note.id }]
    : []);
}

export function wallsInsideRect(walls: readonly { id: string; p1: [number, number]; p2: [number, number] }[], rect: { x: number; y: number; w: number; h: number }): PlaceableRef[] {
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  return walls.flatMap(wall => {
    const left = Math.min(wall.p1[0], wall.p2[0]);
    const top = Math.min(wall.p1[1], wall.p2[1]);
    const wallRight = Math.max(wall.p1[0], wall.p2[0]);
    const wallBottom = Math.max(wall.p1[1], wall.p2[1]);
    return wallRight >= rect.x && left <= right && wallBottom >= rect.y && top <= bottom
      ? [{ kind: 'wall' as const, id: wall.id }]
      : [];
  });
}
