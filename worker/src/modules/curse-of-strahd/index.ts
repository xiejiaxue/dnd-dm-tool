import { getStrahdCard, searchStrahd, strahdToken } from '../../../../shared/strahd';
import { HttpError } from '../../http';
import type { AdventureModule } from '../types';
import { initializeStrahdTokens, strahdSceneFor, strahdScenes, strahdTokens } from './scenes';

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
  routes: [{
    path: 'strahd-scene', param: true, methods: ['GET', 'POST'], moderatorOnly: true,
    async handle({ method, param, state, body, mutate }) {
      const scene = state().scenes[param!];
      if (!scene) return { status: 404, body: { error: '找不到场景' } };
      const preset = strahdSceneFor(scene);
      if (method === 'GET') return { body: preset ?? null };
      const input = await body();
      const spec = preset?.encounters.find(e => e.key === input.encounterKey);
      const count = input.count;
      if (!spec || typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 100)
        return { status: 400, body: { error: '请选择本场景遭遇，数量须为 1–100' } };
      return { body: mutate(input.id, 'scene.strahd-encounter', next => {
        const target = next.scenes[scene.id];
        const offset = target.tokens.filter(t => t.entryId === spec.entryId).length;
        const tokens = strahdTokens(target, spec, count, offset).map(t => ({ ...t, id: crypto.randomUUID() }));
        target.tokens.push(...tokens);
        return { added: tokens.length };
      }, [scene.id]) };
    },
  }],
};
