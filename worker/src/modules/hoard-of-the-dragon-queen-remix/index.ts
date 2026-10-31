import { getHoardRemixCard, hoardRemixToken, searchHoardRemix } from '../../../../shared/hoard-remix';
import presets from '../../../../shared/hoard-remix/scenes.json';
import type { PresetScene } from '../../../../shared/encounter-presets';
import { HttpError } from '../../http';
import { initializePresetTokens, presetSceneRoute } from '../preset-encounters';
import type { AdventureModule } from '../types';

export const hoardRemixScenes: PresetScene[] = presets;

/**
 * 龙后的宝山（重置版）: the user's local reconstruction (重构版) of Hoard of the Dragon Queen. It reuses the
 * original maps and cards with its own scene presets, clues and timeline; the original module stays unchanged.
 */
export const hoardOfTheDragonQueenRemix: AdventureModule = {
  id: 'hoard-of-the-dragon-queen-remix',
  library: { name: '龙后的宝山（重置版）', description: '本地重构剧情 · 13 张地图 · 线索、固定日历与精简遭遇' },
  scenes: {
    count: 13,
    // Same calibrated maps as the original module; presets place only the reconstruction's default groups.
    prepare(map) {
      const preset = hoardRemixScenes.find(s => s.map.assetId === map.assetId);
      if (!preset || preset.map.width !== map.width || preset.map.height !== map.height)
        throw new HttpError(503, 'MODULE_INVALID', '模组版本与地图不匹配');
      return scene => initializePresetTokens('hdqr', scene, preset);
    },
  },
  compendium: { search: searchHoardRemix, monsterCard: getHoardRemixCard, token: hoardRemixToken },
  presets: hoardRemixScenes,
  routes: [presetSceneRoute('hoard-remix-scene', 'scene.hoard-remix-encounter', 'hdqr', hoardRemixScenes)],
};
