import catalog from '../../../../shared/hoard-remix/index.json';
import EncounterModuleTab, { type EncounterModuleConfig } from './EncounterModuleTab';
import type { DetailEntry, QuerySceneState } from './types';

const config: EncounterModuleConfig = {
  title: '龙后的宝山 · 重置版（本地重构）', route: 'hoard-remix-scene',
  catalog: catalog.map(n => ({ ...n, type: 'monster' as const })),
  searchLabel: '搜索重置版资料', chapterLabel: '重置版场景', notesLabel: '场景目标、线索、时限与出口',
  sceneSummary: '只预置重置版的默认编组并对玩家隐藏；未列出的原版敌人与陷阱不自动出现。追兵、增援与条件事件按触发时加入。',
  notPresetText: '当前地图不是龙后的宝山（重置版）预设场景。可在「NPC 与怪物库」选取人物，或从首页选择本模组新建战役。',
  libraryText: count => `${count} 份数据卡，沿用原版全部资料，另含重置版自编配置（如博格的老兵数据）。`,
  areas: true,
};
export default function HoardRemixTab(props: QuerySceneState & { setDetail: (entry: DetailEntry) => void }) {
  return <EncounterModuleTab config={config} {...props} />;
}
