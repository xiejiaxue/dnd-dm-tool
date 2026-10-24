import catalog from '../../../../shared/strahd/index.json';
import EncounterModuleTab, { type EncounterModuleConfig } from './EncounterModuleTab';
import type { DetailEntry, QuerySceneState } from './types';

const config: EncounterModuleConfig = {
  title: '施特拉德的诅咒 · 2014 版', route: 'strahd-scene',
  catalog: catalog.map(n => ({ ...n, type: 'monster' as const })),
  searchLabel: '搜索施特拉德资料', chapterLabel: '施特拉德章节', notesLabel: '机关、战术与避免重复计数',
  sceneSummary: '固定单位已按区域预置并对玩家隐藏。随机遭遇、增援与跨层人物按条件加入；跨图同名人物需沿用实际存活状态。',
  notPresetText: '当前地图不是施特拉德预设场景。可在「NPC 与怪物库」选取人物，或从首页选择本模组新建战役。',
  libraryText: count => `${count} 份数据卡，保留场景调整产生的不同版本。`,
};
export default function StrahdTab(props: QuerySceneState & { setDetail: (entry: DetailEntry) => void }) {
  return <EncounterModuleTab config={config} {...props} />;
}
