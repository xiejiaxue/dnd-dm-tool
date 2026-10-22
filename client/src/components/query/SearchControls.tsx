import type { EntryType } from '../../types';
import type { useCompendiumSearch } from './useCompendiumSearch';

type Props = Pick<ReturnType<typeof useCompendiumSearch>, 'q' | 'setQ' | 'type' | 'setType'>;

export default function SearchControls({ q, setQ, type, setType }: Props) {
  return (
    <div className="p-2 flex gap-1.5 border-b border-line">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索全部 5e 资料…"
        className="field flex-1" />
      <select value={type} onChange={e => setType(e.target.value as EntryType | 'all')} className="field w-auto">
        <option value="all">全部</option>
        <option value="monster">怪物</option>
        <option value="spell">法术</option>
        <option value="item">装备</option>
        <option value="feat">专长</option>
        <option value="condition">状态</option>
        <option value="race">种族</option>
        <option value="subrace">亚种</option>
        <option value="background">背景</option>
        <option value="class">职业</option>
        <option value="subclass">子职</option>
        <option value="classFeature">职业特性</option>
        <option value="optionalFeature">可选能力</option>
        <option value="language">语言</option>
        <option value="vehicle">载具</option>
        <option value="action">动作</option>
        <option value="reward">奖励</option>
      </select>
    </div>
  );
}
