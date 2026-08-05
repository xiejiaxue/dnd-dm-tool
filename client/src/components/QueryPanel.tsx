import { useEffect, useState } from 'react';
import { api } from '../api';
import { connection } from '../ws';
import { useScene } from '../ws';
import DetailDrawer from './DetailDrawer';
import type { EntryType, IndexEntry } from '../types';

type Tab = 'query' | 'fav';

interface Props {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export default function QueryPanel({ collapsed, onToggleCollapsed }: Props) {
  const [tab, setTab] = useState<Tab>('query');
  const [q, setQ] = useState('');
  const [type, setType] = useState<EntryType | 'all'>('all');
  const [results, setResults] = useState<IndexEntry[]>([]);
  // DetailDrawer only needs the id trio; both search results and favorites fit it.
  const [detail, setDetail] = useState<{ type: EntryType; id: string; nameZh: string } | null>(null);
  const { scene, role } = useScene();
  // Favorites tab: resolve the Chinese name for each favorited entryId.
  const [favNames, setFavNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const favs = scene?.favorites ?? [];
    const missing = favs.filter(f => !(f.entryId in favNames));
    if (missing.length === 0) return;
    let alive = true;
    for (const f of missing) {
      api.entry(f.type, f.entryId)
        .then(e => { if (alive) setFavNames(prev => ({ ...prev, [f.entryId]: e.name ?? f.entryId })); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [scene?.favorites, favNames]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!q.trim()) { setResults([]); return; }
      api.search(q, type).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, type]);

  // Directly add a monster token to the scene, tiled in a grid around the
  // play-area centre so repeated adds don't stack exactly on top of each other.
  const addMonsterToScene = (r: IndexEntry) => {
    if (!scene) return;
    const area = scene.playArea;
    const i = scene.tokens.filter(t => t.entryId === r.id).length;
    const x = area.x + area.w / 2 + (i % 4 - 1) * 100;
    const y = area.y + area.h / 2 + (Math.floor(i / 4) - 1) * 100;
    connection.sendOps([{
      op: 'addToken',
      token: {
        id: `t${Date.now()}-${i}`,
        kind: 'monster',
        name: r.nameZh,
        entryId: r.id,
        x, y, size: 100,
        avatar: `/api/token/${r.id}`,
        color: '#fff',
      },
    }]);
  };

  const favorites = scene?.favorites ?? [];

  // Collapsed: a thin vertical bar so players can reclaim board space.
  if (collapsed) {
    return (
      <aside className="w-10 border-l border-zinc-700/60 bg-zinc-900 flex flex-col items-center pt-2 text-sm">
        <button
          onClick={onToggleCollapsed}
          title="展开查询面板"
          className="w-8 h-8 rounded-md hover:bg-zinc-700 text-zinc-400 text-lg"
        >⇥</button>
      </aside>
    );
  }

  return (
    <aside className="w-80 border-l border-zinc-700/60 bg-zinc-900 flex flex-col text-sm relative">
      <div className="flex items-center border-b border-zinc-800">
        {(['query', 'fav'] as Tab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setDetail(null); }}
            className={`flex-1 py-2 text-center ${tab === t ? 'text-amber-400 border-b-2 border-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {t === 'query' ? '查询' : '收藏夹'}
          </button>
        ))}
        <button
          onClick={onToggleCollapsed}
          title="收起查询面板"
          className="shrink-0 px-2 h-8 text-zinc-500 hover:text-zinc-200 text-lg"
        >⇤</button>
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
                <div key={r.id} className="flex items-center border-b border-zinc-800/50 hover:bg-zinc-800">
                  <button onClick={() => setDetail(r)} className="flex-1 text-left px-3 py-2 min-w-0">
                    <span className="block text-zinc-100 truncate">{r.nameZh}</span>
                    <span className="block text-xs text-zinc-500 truncate">{r.nameEn} · {r.source}</span>
                  </button>
                  <span className="shrink-0 text-xs text-amber-400/80 pr-1">
                    {r.type === 'monster' ? r.cr ?? '' : r.type === 'spell' ? `${r.level ?? 0} 环` : ''}
                  </span>
                  {role === 'dm' && r.type === 'monster' && (
                    <button
                      onClick={() => addMonsterToScene(r)}
                      title="添加到场景"
                      className="shrink-0 mr-2 ml-1 px-2 py-1 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 text-xs"
                    >＋ 添加</button>
                  )}
                </div>
              ))}
              {q.trim() && results.length === 0 && <div className="p-3 text-zinc-500 text-xs">无结果</div>}
            </div>
          )}
          {tab === 'fav' && (
            <div className="flex-1 overflow-y-auto">
              {favorites.length === 0 && <div className="p-3 text-zinc-500 text-xs">收藏夹为空，从查询中点击 ★ 收藏</div>}
              {favorites.map(f => {
                const zh = favNames[f.entryId] ?? f.entryId;
                return (
                  <button key={`${f.type}-${f.entryId}`}
                    onClick={() => setDetail({ type: f.type, id: f.entryId, nameZh: zh })}
                    className="w-full text-left px-3 py-2 border-b border-zinc-800/50 flex justify-between items-center hover:bg-zinc-800">
                    <span>
                      <span className="block text-zinc-100">{zh}</span>
                      <span className="block text-xs text-zinc-500">{f.entryId}</span>
                    </span>
                    <button className="text-zinc-500 hover:text-red-400 shrink-0"
                      onClick={(e) => { e.stopPropagation(); connection.sendOps([{ op: 'removeFavorite', type: f.type, entryId: f.entryId }]); }}>✕</button>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
