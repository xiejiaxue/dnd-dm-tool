import catalog from '../../../../shared/hoard/index.json';
import EncounterModuleTab, { type EncounterModuleConfig } from './EncounterModuleTab';
import type { DetailEntry, QuerySceneState } from './types';

const config: EncounterModuleConfig = {
  title: '龙后的宝山 · 2014 版', route: 'hoard-scene',
  catalog: catalog.map(n => ({ ...n, type: 'monster' as const })),
  searchLabel: '搜索龙后资料', chapterLabel: '龙后章节', notesLabel: '场景概况、通用规则与奖励',
  sceneSummary: '固定单位与在场人物已按房间预置并对玩家隐藏。条件遭遇、夜间换岗、援军与随机遭遇按触发时加入。',
  notPresetText: '当前地图不是龙后的宝山预设场景。可在「NPC 与怪物库」选取人物，或从首页选择本模组新建战役。',
  libraryText: count => `${count} 份数据卡，含附录 B 全部怪物、2014 通用模板、具名人物与商队旅伴。`,
  areas: true,
};
export default function HoardTab(props: QuerySceneState & { setDetail: (entry: DetailEntry) => void }) {
  return <EncounterModuleTab config={config} {...props} />;
}
