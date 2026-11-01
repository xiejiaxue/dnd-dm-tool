import { describe, expect, it } from 'vitest';
import { applyHandoutOp, applyMapNoteOp, MAX_HANDOUTS, shownHandout } from './table-state';
import type { MapNote } from './types';

const note: MapNote = { id: 'n1', x: 10, y: 20, title: '密室', text: '一口箱子', visible: false };

describe('map notes', () => {
  it('adds, edits, links and removes notes without touching the input', () => {
    const notes = applyMapNoteOp(undefined, { op: 'addMapNote', note });
    expect(notes).toEqual([note]);
    expect(applyMapNoteOp(notes, { op: 'addMapNote', note: { ...note, title: 'dup' } })).toEqual([note]);
    const linked = applyMapNoteOp(notes, { op: 'updateMapNote', noteId: 'n1', patch: { visible: true, journal: { id: 'j1', title: '线索' } } });
    expect(linked[0]).toMatchObject({ visible: true, journal: { id: 'j1', title: '线索' } });
    expect(notes[0].visible).toBe(false);
    const unlinked = applyMapNoteOp(linked, { op: 'updateMapNote', noteId: 'n1', patch: { journal: null } });
    expect(unlinked[0].journal).toBeUndefined();
    expect(applyMapNoteOp(unlinked, { op: 'removeMapNote', noteId: 'n1' })).toEqual([]);
  });
});

describe('handouts', () => {
  it('shows an image, keeps the history newest first and hides it again', () => {
    const map = { id: 'h1', title: '地图', image: '/api/campaigns/x/assets/1' };
    const letter = { id: 'h2', title: '信', image: '/api/campaigns/x/assets/2' };
    let state = applyHandoutOp({}, { op: 'showHandout', handout: map });
    state = applyHandoutOp(state, { op: 'showHandout', handout: letter });
    expect(state.handouts!.map(h => h.id)).toEqual(['h2', 'h1']);
    expect(shownHandout(state)).toEqual(letter);
    state = applyHandoutOp(state, { op: 'showHandout', handout: map });
    expect(state.handouts!.map(h => h.id)).toEqual(['h1', 'h2']);
    expect(shownHandout(applyHandoutOp(state, { op: 'hideHandout' }))).toBeNull();
    const removed = applyHandoutOp(state, { op: 'removeHandout', handoutId: 'h1' });
    expect(removed).toEqual({ handouts: [letter], shownHandoutId: undefined });
  });

  it('caps the history', () => {
    let state = {};
    for (let i = 0; i < MAX_HANDOUTS + 5; i++) state = applyHandoutOp(state, { op: 'showHandout', handout: { id: `h${i}`, title: '', image: '/api/campaigns/x/assets/i' } });
    expect(applyHandoutOp(state, { op: 'hideHandout' }).handouts).toHaveLength(MAX_HANDOUTS);
  });
});
