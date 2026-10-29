import presets from '../../../../shared/strahd/scenes.json';
import type { Scene } from '../../../../shared/types';
import type { StrahdEncounter, StrahdScene } from '../../../../shared/strahd-types';
import { initializePresetTokens, presetSceneFor, presetTokens } from '../preset-encounters';
export const strahdScenes: StrahdScene[] = presets;
export const strahdSceneFor = (scene: Scene) => presetSceneFor(strahdScenes, scene);
export const strahdTokens = (scene: Scene, spec: StrahdEncounter, count: number, offset = 0, total = count + offset) =>
  presetTokens('cos', scene, spec, count, offset, total);
export const initializeStrahdTokens = (scene: Scene, preset: StrahdScene) => initializePresetTokens('cos', scene, preset);
