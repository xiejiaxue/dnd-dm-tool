import { getStrahdRemixCard, searchStrahdRemix, strahdRemixToken } from '../../../../shared/strahd-remix';
import presets from '../../../../shared/strahd-remix/scenes.json';
import type { PresetScene } from '../../../../shared/encounter-presets';
import { HttpError } from '../../http';
import { initializePresetTokens, presetSceneRoute } from '../preset-encounters';
import type { AdventureModule } from '../types';

export const strahdRemixScenes: PresetScene[] = presets;

/**
 * 施特拉德的诅咒（重置版 v2）: the user's local eight-session reconstruction. It reuses the original maps and
 * cards with its own scene notes, area notes and default groups; the original module stays unchanged.
 */
export const curseOfStrahdRemix: AdventureModule = {
  id: 'curse-of-strahd-remix',
  library: { name: '施特拉德的诅咒（重置版 v2）', description: '8 次团重构 · 18 张地图 · 场景目标、地点手册与精简遭遇' },
  scenes: {
    count: 18,
    // Same maps as the original module; presets place only the reconstruction's default groups.
    prepare(map) {
      const preset = strahdRemixScenes.find(s => s.map.assetId === map.assetId);
      if (!preset || preset.map.width !== map.width || preset.map.height !== map.height)
        throw new HttpError(503, 'MODULE_INVALID', '模组版本与地图不匹配');
      return scene => initializePresetTokens('cosr', scene, preset);
    },
  },
  compendium: { search: searchStrahdRemix, monsterCard: getStrahdRemixCard, token: strahdRemixToken },
  routes: [presetSceneRoute('strahd-remix-scene', 'scene.strahd-remix-encounter', 'cosr', strahdRemixScenes)],
};
