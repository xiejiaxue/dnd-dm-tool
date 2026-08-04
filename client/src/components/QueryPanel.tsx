import { useEffect, useState } from 'react';
import { api } from '../api';
import { connection } from '../ws';
import { useScene } from '../ws';
import DetailDrawer from './DetailDrawer';
import type { EntryType, IndexEntry } from '../types';

type Tab = 'query' | 'fav';

export default function QueryPanel() {
  const [tab, setTab] = useState<Tab>('query');
  const [q, setQ] = useState('');
  const [type, setType] = useState<EntryType | 'all'>('all');
  const [results, setResults] = useState<IndexEntry[]>([]);
  const [detail, setDetail] = useState<IndexEntry | null>(null);
  const { scene } = useScene();

  useEffect(() => {
    const t = setTimeout(() => {
      if (!q.trim()) { setResults([]); return; }
      api.search(q, type).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, type]);

  const favorites = scene?.favorites ?? [];

  return (
    <aside className="w-80 border-l border-zinc-700/60 bg-zinc-900 flex flex-col text-sm relative">
      <div className="flex border-b border-zinc-800">
        {(['query', 'fav'] as Tab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setDetail(null); }}
            className={`flex-1 py-2 text-center ${tab === t ? 'text-amber-400 border-b-2 border-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {t === 'query' ? '查询' : '收藏夹'}
          </button>
        ))}
      </div>

      {detail ? (
        <DetailDrawer entry={detail} onBack={() => setDetail(null)} />
      ) : (
        <>
          <div className="p-2 flex gap-1">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索怪物 / 法术 / 装备…"
              className="flex-1 bg-zinc-800 rounded px-2 py-1 outline-none focus:ring-1 ring-amber-500" />
            <select value={type} onChange={e => setType(e.target.value as EntryType | 'all')} className="bg-zinc-800 rounded px-1">
              <option value="all">全部</option>
              <option value="monster">怪物</option>
              <option value="spell">法术</option>
              <option value="item">装备</option>
              <option value="feat">专长</option>
            </select>
          </div>
          {tab === 'query' && (
            <div className="flex-1 overflow-y-auto">
              {results.map(r => (
                <button key={r.id} onClick={() => setDetail(r)}
                  className="w-full text-left px-3 py-2 hover:bg-zinc-800 border-b border-zinc-800/50 flex justify-between gap-2">
                  <span>
                    <span className="block text-zinc-100">{r.nameZh}</span>
                    <span className="block text-xs text-zinc-500">{r.nameEn} · {r.source}</span>
                  </span>
                  <span className="shrink-0 text-xs text-amber-400/80 self-center">
                    {r.type === 'monster' ? r.cr ?? '' : r.type === 'spell' ? `${r.level ?? 0} 环` : ''}
                  </span>
                </button>
              ))}
              {q.trim() && results.length === 0 && <div className="p-3 text-zinc-500 text-xs">无结果</div>}
            </div>
          )}
          {tab === 'fav' && (
            <div className="flex-1 overflow-y-auto">
              {favorites.length === 0 && <div className="p-3 text-zinc-500 text-xs">收藏夹为空，从查询中点击 ★ 收藏</div>}
              {favorites.map(f => (
                <div key={`${f.type}-${f.entryId}`} className="px-3 py-2 border-b border-zinc-800/50 flex justify-between items-center">
                  <span className="text-zinc-200">{f.type} · {f.entryId}</span>
                  <button className="text-zinc-500 hover:text-red-400"
                    onClick={() => connection.sendOps([{ op: 'removeFavorite', type: f.type, entryId: f.entryId }])}>✕</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
