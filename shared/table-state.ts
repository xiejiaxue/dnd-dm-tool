import type { Campaign, Handout, MapNote, Op } from './types';

// Map notes and handouts are applied by the room and predicted by the browser
// with these same reducers. They never mutate their input.

export const MAX_MAP_NOTES = 200;
export const MAP_NOTE_TEXT_LIMIT = 4_000;
export const MAX_HANDOUTS = 24;

type NoteOp = Extract<Op, { op: 'addMapNote' | 'updateMapNote' | 'removeMapNote' }>;
type HandoutOp = Extract<Op, { op: 'showHandout' | 'hideHandout' | 'removeHandout' }>;
type HandoutState = Pick<Campaign, 'handouts' | 'shownHandoutId'>;

export function applyMapNoteOp(notes: readonly MapNote[] | undefined, op: NoteOp): MapNote[] {
  const current = notes ?? [];
  switch (op.op) {
    case 'addMapNote':
      return current.some((note) => note.id === op.note.id) || current.length >= MAX_MAP_NOTES
        ? [...current]
        : [...current, cloneNote(op.note)];
    case 'updateMapNote':
      return current.map((note) => {
        if (note.id !== op.noteId) return note;
        const { journal, ...rest } = op.patch;
        const next: MapNote = { ...note, ...rest };
        if (journal === null) delete next.journal;
        else if (journal) next.journal = { ...journal };
        return next;
      });
    case 'removeMapNote':
      return current.filter((note) => note.id !== op.noteId);
  }
}

export function applyHandoutOp(campaign: HandoutState, op: HandoutOp): HandoutState {
  const handouts = campaign.handouts ?? [];
  switch (op.op) {
    case 'showHandout': {
      // Showing an image again moves it to the front of the history.
      const shown: Handout = { ...op.handout };
      return { handouts: [shown, ...handouts.filter((handout) => handout.id !== shown.id)].slice(0, MAX_HANDOUTS), shownHandoutId: shown.id };
    }
    case 'hideHandout':
      return { handouts, shownHandoutId: undefined };
    case 'removeHandout':
      return {
        handouts: handouts.filter((handout) => handout.id !== op.handoutId),
        shownHandoutId: campaign.shownHandoutId === op.handoutId ? undefined : campaign.shownHandoutId,
      };
  }
}

export function shownHandout(campaign: HandoutState | null | undefined): Handout | null {
  if (!campaign?.shownHandoutId) return null;
  return campaign.handouts?.find((handout) => handout.id === campaign.shownHandoutId) ?? null;
}

function cloneNote(note: MapNote): MapNote {
  return { ...note, ...(note.journal ? { journal: { ...note.journal } } : {}) };
}
