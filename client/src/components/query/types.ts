import type { EntryType } from '../../types';
import type { SceneState } from '../../ws';

export type DetailEntry = { type: EntryType; id: string; nameZh: string };
export type QuerySceneState = Pick<SceneState, 'scene' | 'role' | 'campaign'>;

/** Text shown in the panel's detail slot: a module area note or scene overview. */
export type NoteDetail = { type: 'note'; id: string; title: string; meta: string; text: string; sceneId?: string; highlight?: string[] };
export type PanelDetail = DetailEntry | NoteDetail;
/** Asks a tab to open on one item; a new nonce remounts the tab even when the item repeats. */
export type QuestFocus = { chainId: string; questId: string; nonce: number };
export type JournalFocus = { id: string; nonce: number };
