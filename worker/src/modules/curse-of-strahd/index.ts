import { getStrahdCard, searchStrahd, strahdToken } from '../../../../shared/strahd';
import { HttpError } from '../../http';
import { presetSceneRoute } from '../preset-encounters';
import type { AdventureModule } from '../types';
import { initializeStrahdTokens, strahdScenes } from './scenes';

export const curseOfStrahd: AdventureModule = {
  id: 'curse-of-strahd',
  library: { name: '施特拉德的诅咒', description: '36 个场景 · 36 张地图 · 中文数据卡与场景 Token' },
  scenes: {
    count: 36,
    // Every map must match a validated built-in encounter preset, which also places its opening tokens.
    prepare(map) {
      const preset = strahdScenes.find(s => s.map.assetId === map.assetId);
      if (!preset || preset.map.width !== map.width || preset.map.height !== map.height)
        throw new HttpError(503, 'MODULE_INVALID', '模组版本与地图不匹配');
      return scene => initializeStrahdTokens(scene, preset);
    },
  },
  compendium: { search: searchStrahd, monsterCard: getStrahdCard, token: strahdToken },
  routes: [presetSceneRoute('strahd-scene', 'scene.strahd-encounter', 'cos', strahdScenes)],
};
