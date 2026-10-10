import type { EntryType } from '../../types';
import type { SceneState } from '../../ws';

export type DetailEntry = { type: EntryType; id: string; nameZh: string };
export type QuerySceneState = Pick<SceneState, 'scene' | 'role' | 'campaign'>;
