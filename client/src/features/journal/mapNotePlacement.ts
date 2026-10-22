import type { MapNote } from '../../types';

export type PendingMapNote = Pick<MapNote, 'journalId' | 'pageId' | 'label' | 'icon' | 'visibility'>;
type Listener = (note: PendingMapNote | null) => void;

let pending: PendingMapNote | null = null;
const listeners = new Set<Listener>();

export function setPendingMapNote(note: PendingMapNote | null): void {
  pending = note;
  for (const listener of listeners) listener(note);
}

export function subscribePendingMapNote(listener: Listener): () => void {
  listeners.add(listener);
  listener(pending);
  return () => listeners.delete(listener);
}

