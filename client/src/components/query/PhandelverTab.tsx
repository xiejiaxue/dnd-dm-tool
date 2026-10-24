import catalog from '../../../../shared/phandelver/index.json';
import EncounterModuleTab, { type EncounterModuleConfig } from './EncounterModuleTab';
import type { DetailEntry, QuerySceneState } from './types';

const config: EncounterModuleConfig = {
  title: '凡戴尔的失落矿坑 · 2014 版', route: 'phandelver-scene',
  catalog: catalog.map(n => ({ ...n, type: 'monster' as const })),
  searchLabel: '搜索凡戴尔资料', chapterLabel: '凡戴尔章节', notesLabel: '场景概况、通用特征与奖励',
  sceneSummary: '固定单位与在场人物已按房间预置并对玩家隐藏。条件遭遇、返程小队与随机遭遇按触发时加入。',
  notPresetText: '当前地图不是凡戴尔预设场景。可在「NPC 与怪物库」选取人物，或从首页选择本模组新建战役。',
  libraryText: count => `${count} 份数据卡，含附录 B 全部怪物、具名角色与凡达林镇民。`,
  areas: true,
};
export default function PhandelverTab(props: QuerySceneState & { setDetail: (entry: DetailEntry) => void }) {
  return <EncounterModuleTab config={config} {...props} />;
}
