import { getWaterdeepCard, searchWaterdeep, waterdeepToken } from '../../../../shared/waterdeep';
import type { AdventureModule } from '../types';
import { deployWaterdeep } from './deployment';

export const waterdeepDragonHeist: AdventureModule = {
  id: 'waterdeep-dragon-heist',
  library: { name: '深水城：龙金劫', description: '21 个场景 · 21 张地图 · 不含 NPC 档案' },
  // Map-only import; NPCs are placed later through the deployment route.
  scenes: { count: 21 },
  compendium: { search: searchWaterdeep, monsterCard: getWaterdeepCard, token: waterdeepToken },
  routes: [{
    // Matches scenes by name, so it also serves campaigns that imported these maps by hand.
    path: 'waterdeep-deployment', param: false, methods: ['GET', 'POST'], moderatorOnly: true,
    async handle({ method, actor, state, body, mutate }) {
      if (method === 'GET') return { body: deployWaterdeep(state(), actor) };
      const input = await body();
      return { body: mutate(input.id, 'scene.deploy-waterdeep', next => deployWaterdeep(next, actor, true), []) };
    },
  }],
};
