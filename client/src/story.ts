import type { QuestStatus } from '../../shared/faction-quests';
import type { Campaign } from './types';
import type { PresetArea } from '../../shared/encounter-presets';

/**
 * The story route keeps its progress in the campaign's DM-only quest tracking, so it needs no new
 * storage: a scene's status under `scene:<id>`, an explored room under `area:<scene>:<key>`.
 */
export const sceneQuestId = (sceneId: string) => `scene:${sceneId}`;
export const areaQuestId = (sceneId: string, areaKey: string) => `area:${sceneId}:${areaKey}`;

export type SceneStage = 'open' | 'active' | 'done';
export const SCENE_STAGE_LABELS: Record<SceneStage, string> = { open: '未开始', active: '进行中', done: '已完成' };
export const nextStage = (stage: SceneStage): SceneStage => stage === 'open' ? 'active' : stage === 'active' ? 'done' : 'open';

export function sceneStage(campaign: Pick<Campaign, 'questProgress'> | null | undefined, sceneId: string): SceneStage {
  const status: QuestStatus | undefined = campaign?.questProgress?.[sceneQuestId(sceneId)];
  return status === 'active' || status === 'done' ? status : 'open';
}

export function areaExplored(campaign: Pick<Campaign, 'questProgress'> | null | undefined, sceneId: string, areaKey: string) {
  return campaign?.questProgress?.[areaQuestId(sceneId, areaKey)] === 'done';
}

/** Campaign templates whose maps carry keyed room notes, and the DM route that serves a scene's preset. */
export const PRESET_ROUTES: Record<string, string> = {
  'curse-of-strahd': 'strahd-scene',
  'curse-of-strahd-remix': 'strahd-remix-scene',
  'lost-mine-of-phandelver': 'phandelver-scene',
  'hoard-of-the-dragon-queen': 'hoard-scene',
  'hoard-of-the-dragon-queen-remix': 'hoard-remix-scene',
};

/** A room's title as the map prints it: numbered rooms read "12. 名称". */
export const areaTitle = (area: Pick<PresetArea, 'key' | 'name'>) => /^\d+$/.test(area.key) ? `${area.key}. ${area.name}` : area.name;
