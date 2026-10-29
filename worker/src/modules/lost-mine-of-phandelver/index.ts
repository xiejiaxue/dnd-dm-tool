import { getPhandelverCard, phandelverToken, searchPhandelver } from '../../../../shared/phandelver';
import presets from '../../../../shared/phandelver/scenes.json';
import type { PresetScene } from '../../../../shared/encounter-presets';
import { HttpError } from '../../http';
import { initializePresetTokens, presetSceneRoute } from '../preset-encounters';
import type { AdventureModule } from '../types';

export const phandelverScenes: PresetScene[] = presets;

export const lostMineOfPhandelver: AdventureModule = {
  id: 'lost-mine-of-phandelver',
  library: { name: '凡戴尔的失落矿坑', description: '7 个场景 · 7 张地图 · 中文数据卡、区域要点与场景 Token' },
  scenes: {
    count: 7,
    // Maps are calibrated so one printed square is one board grid cell; presets place hidden opening tokens.
    prepare(map) {
      const preset = phandelverScenes.find(s => s.map.assetId === map.assetId);
      if (!preset || preset.map.width !== map.width || preset.map.height !== map.height)
        throw new HttpError(503, 'MODULE_INVALID', '模组版本与地图不匹配');
      return scene => initializePresetTokens('lmop', scene, preset);
    },
  },
  compendium: { search: searchPhandelver, monsterCard: getPhandelverCard, token: phandelverToken },
  routes: [presetSceneRoute('phandelver-scene', 'scene.phandelver-encounter', 'lmop', phandelverScenes)],
};
