import { useState } from 'react';
import { waterdeepIndex } from '../../waterdeep';
import { connection } from '../../ws';
import { spawnEnemy } from './actions';
import type { DetailEntry, QuerySceneState } from './types';

export default function WaterdeepTab({ scene, role, campaign, setDetail }: QuerySceneState & { setDetail: (entry: DetailEntry) => void }) {
  const [query, setQuery] = useState('');
  const [faction, setFaction] = useState('');
  const [combatOnly, setCombatOnly] = useState(true);
  const factions = [...new Set(waterdeepIndex.map(n => n.faction))];
  const rows = waterdeepIndex.filter(n => (!combatOnly || n.combat) && (!faction || n.faction === faction) && `${n.nameZh} ${n.nameEn} ${n.location} ${n.template}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="flex-1 flex flex-col min-h-0">
    <div className="p-3 border-b border-line space-y-2">
      <div className="flex items-center justify-between"><strong className="text-sm">深水城 NPC</strong><span className="text-xs text-muted">{rows.length} 人 · 2014 版</span></div>
      <input aria-label="搜索深水城NPC" placeholder="姓名、别名、地点或模板" value={query} onChange={e => setQuery(e.target.value)} className="w-full bg-well border border-line rounded px-2 py-1.5 text-sm" />
      <select aria-label="NPC所属派系" value={faction} onChange={e => setFaction(e.target.value)} className="w-full bg-well border border-line rounded px-2 py-1.5 text-sm"><option value="">全部派系</option>{factions.map(f => <option key={f}>{f}</option>)}</select>
      <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={combatOnly} onChange={e => setCombatOnly(e.target.checked)} />仅显示战斗 NPC</label>
      <p className="text-xs text-muted">点击人物查看数据卡。派系颜色与姓名标记用于辨认 Token；角色调整优先于基础模板。</p>
    </div>
    <div className="flex-1 overflow-y-auto">
      {rows.map(n => <div key={n.id} className="p-3 border-b border-line hover:bg-well">
        <button onClick={() => setDetail(n)} className="w-full flex gap-3 text-left items-center">
          <img loading="lazy" src={`/api/token/${encodeURIComponent(n.id)}`} alt={`${n.nameZh} Token`} className="w-12 h-12 rounded-full shrink-0" />
          <span className="min-w-0 flex-1"><strong className="block text-sm">{n.nameZh}</strong><span className="block text-xs text-muted">{n.faction} · {n.category}</span><span className="block text-xs text-muted">{n.template} · CR {n.cr || '—'} · HP {n.hp}</span></span>
        </button>
        {role === 'dm' && <div className="mt-2 flex gap-3 justify-end text-xs">
          <button className="text-accent hover:underline" onClick={() => spawnEnemy(scene, n.id, n.nameZh)}>＋ 放置 Token</button>
          <button className="text-accent hover:underline disabled:text-muted" disabled={campaign?.enemies.some(e => e.entryId === n.id)} onClick={() => connection.sendOps([{ op: 'addEnemy', entryId: n.id, nameZh: n.nameZh }])}>{campaign?.enemies.some(e => e.entryId === n.id) ? '已在战役库' : '加入战役库'}</button>
        </div>}
      </div>)}
      {!rows.length && <p className="p-3 text-sm text-muted">没有符合条件的 NPC。</p>}
    </div>
  </div>;
}
