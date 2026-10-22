import { useEffect, useState } from 'react';
import { api } from '../api';
import { connection } from '../ws';
import { useScene } from '../ws';
import { formatCompendiumEntry, StatBlock } from '../format';
import { setPending } from '../pending';
import type { EntryType } from '../types';
import StatBlockView from './StatBlockView';

export default function DetailDrawer({ entry, onBack }: { entry: { type: EntryType; id: string; nameZh: string } | null; onBack: () => void }) {
  const { scene, role } = useScene();
  const [stat, setStat] = useState<StatBlock | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entry) { setStat(null); return; }
    let cancelled = false;
    setLoading(true);
    api.entry(entry.type, entry.id)
      .then(e => {
        if (!cancelled) setStat(formatCompendiumEntry(entry.type, e));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entry]);

  if (!entry) return null;
  const fav = scene?.favorites.some(f => f.type === entry.type && f.entryId === entry.id);

  return (
    <div className="absolute inset-0 z-10 bg-zinc-900 overflow-y-auto p-3 text-sm">
      <div className="flex items-center gap-2 mb-2">
        <button onClick={onBack} aria-label="返回列表" title="返回资料列表" className="text-zinc-400 hover:text-white">←</button>
        <h2 className="font-bold text-base">{entry.nameZh}</h2>
      </div>
      {loading && <div className="text-zinc-500">加载中…</div>}
      {stat && <StatBlockView stat={stat} />}
      <div className="mt-3 flex gap-2">
        {role !== 'spectator' && (
          <button
            onClick={() => connection.sendOps([{ op: 'addFavorite', favorite: { type: entry.type, entryId: entry.id } }])}
            title={fav ? '该条目已在收藏夹中' : '加入收藏夹以便快速查找'}
            className="flex-1 rounded bg-zinc-800 py-1.5 hover:bg-zinc-700"
          >{fav ? '已收藏' : '★ 收藏'}</button>
        )}
        {role === 'dm' && entry.type === 'monster' && (
          <button
            onClick={() => setPending({
              kind: 'monster', name: entry.nameZh, entryId: entry.id,
              avatar: `/api/token/${entry.id}`, color: '#fff',
            })}
            title="拿起怪物 Token；随后点击地图完成放置"
            className="flex-1 rounded bg-amber-600/20 text-amber-400 py-1.5 hover:bg-amber-600/30"
          >✋ 拿起</button>
        )}
      </div>
    </div>
  );
}
