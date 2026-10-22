import { useMemo, useState } from 'react';
import { useScene } from '../../ws';
import { useActionLog } from './ActionLogContext';
import { useTabletopSettings } from '../settings/TabletopSettingsContext';

export default function ActionLogPanel() {
  const { entries, loading, refresh, clear } = useActionLog();
  const { role } = useScene();
  const { confirmAction } = useTabletopSettings();
  const [filter, setFilter] = useState('all');
  const visible = useMemo(() => entries.filter(entry => filter === 'all' || entry.type === filter), [entries, filter]);
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-zinc-800 p-2">
        <select value={filter} onChange={event => setFilter(event.target.value)} className="rounded bg-zinc-800 px-2 py-1 text-xs">
          <option value="all">全部记录</option><option value="roll">掷骰</option><option value="damage">伤害</option>
          <option value="healing">治疗</option><option value="effect">效果</option><option value="encounter">战斗</option>
          <option value="handout">展示资料</option>
        </select>
        <button type="button" onClick={() => void refresh()} className="ml-auto rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800">刷新</button>
        {role === 'dm' && <button type="button" onClick={() => { if (confirmAction('清空本房间全部行动记录？')) void clear(); }} className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-red-950/40 hover:text-red-300">清空</button>}
      </header>
      <div className="flex-1 overflow-y-auto">
        {loading && entries.length === 0 && <p className="p-3 text-xs text-zinc-500">正在读取行动记录…</p>}
        {visible.map(entry => (
          <article key={entry.id} className="border-b border-zinc-800/70 px-3 py-2">
            <div className="flex items-baseline gap-2"><span className="text-zinc-100">{entry.label}</span>{entry.total !== null && <strong className="ml-auto text-lg tabular-nums text-amber-300">{entry.total}</strong>}</div>
            <div className="mt-0.5 flex gap-2 text-[10px] text-zinc-500">
              <span>{typeLabel(entry.type)}</span><span>{entry.createdByName}</span><time>{new Date(entry.createdAt).toLocaleTimeString()}</time>
              {entry.visibility === 'gm' && <span className="text-violet-300">仅主持人</span>}
            </div>
            {entry.formula && <code className="mt-1 block text-[11px] text-zinc-400">{entry.formula}</code>}
          </article>
        ))}
        {!loading && visible.length === 0 && <p className="p-3 text-xs text-zinc-500">没有符合条件的记录。</p>}
      </div>
    </div>
  );
}

function typeLabel(type: string): string {
  return ({ roll: '掷骰', damage: '伤害', healing: '治疗', effect: '效果', encounter: '战斗', handout: '资料', system: '系统' } as Record<string, string>)[type] ?? type;
}
