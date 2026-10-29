import catalog from '../../../../shared/strahd-remix/index.json';
import EncounterModuleTab, { type EncounterModuleConfig } from './EncounterModuleTab';
import type { DetailEntry, QuerySceneState } from './types';

const config: EncounterModuleConfig = {
  title: '施特拉德的诅咒 · 重置版 v2（本地重构）', route: 'strahd-remix-scene',
  catalog: catalog.map(n => ({ ...n, type: 'monster' as const })),
  searchLabel: '搜索重置版资料', chapterLabel: '重置版场次', notesLabel: '本次要完成、节奏与开场准备',
  sceneSummary: '只预置重置版的在场人物和固定编组并对玩家隐藏；未列出的原版敌人与陷阱不自动出现。可选战斗、追猎者与条件事件按触发时加入。',
  notPresetText: '当前地图不是施特拉德的诅咒（重置版 v2）预设场景。可在「NPC 与怪物库」选取人物，或从首页选择本模组新建战役。',
  libraryText: count => `${count} 份数据卡，沿用原版全部资料，另含重置版自编配置（残灯会、维斯塔尼刀手、悲痛之心）。`,
  areas: true,
};
export default function StrahdRemixTab(props: QuerySceneState & { setDetail: (entry: DetailEntry) => void }) {
  return <EncounterModuleTab config={config} {...props} />;
}
