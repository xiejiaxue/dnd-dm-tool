import { getHoardCard, hoardToken, searchHoard } from '../../../../shared/hoard';
import presets from '../../../../shared/hoard/scenes.json';
import type { PresetScene } from '../../../../shared/encounter-presets';
import { HttpError } from '../../http';
import { initializePresetTokens, presetSceneRoute } from '../preset-encounters';
import type { AdventureModule } from '../types';

export const hoardScenes: PresetScene[] = presets;

export const hoardOfTheDragonQueen: AdventureModule = {
  id: 'hoard-of-the-dragon-queen',
  library: { name: '龙后的宝山', description: '13 个场景 · 13 张地图 · 中文数据卡、区域要点与场景 Token' },
  scenes: {
    count: 13,
    // Maps are calibrated so one printed square is one board grid cell; presets place hidden opening tokens.
    prepare(map) {
      const preset = hoardScenes.find(s => s.map.assetId === map.assetId);
      if (!preset || preset.map.width !== map.width || preset.map.height !== map.height)
        throw new HttpError(503, 'MODULE_INVALID', '模组版本与地图不匹配');
      return scene => initializePresetTokens('hdq', scene, preset);
    },
  },
  compendium: { search: searchHoard, monsterCard: getHoardCard, token: hoardToken },
  presets: hoardScenes,
  routes: [presetSceneRoute('hoard-scene', 'scene.hoard-encounter', 'hdq', hoardScenes)],
};
