import { useEffect, useState } from 'react';
import { api } from '../api';
import { connection } from '../ws';
import { useScene } from '../ws';
import { formatCompendiumEntry, StatBlock } from '../format';
import { setPending } from '../pending';
import type { EntryType } from '../types';

export default function DetailDrawer({ entry, onBack }: { entry: { type: EntryType; id: string; nameZh: string } | null; onBack: () => void }) {
  const { scene, role } = useScene();
  const [stat, setStat] = useState<StatBlock | null>(null);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!entry) { setStat(null); return; }
    let cancelled = false;
    setLoading(true);
    setAdded(false);
    api.entry(entry.type, entry.id)
      .then(e => {
        if (!cancelled) setStat(formatCompendiumEntry(entry.type, e));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entry]);

  if (!entry) return null;
  const fav = scene?.favorites.some(f => f.type === entry.type && f.entryId === entry.id);

  // Stat-block text carries **bold** markup from the compendium formatter;
  // render it instead of leaking the asterisks (print sheet does the same).
  const rich = (value: string) =>
    value.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));

  return (
    <div className="absolute inset-0 z-10 bg-panel overflow-y-auto p-4 text-sm">
      <div className="flex items-center gap-2 pb-3 border-b-2 border-ink">
        <button onClick={onBack} className="text-muted hover:text-accent text-lg leading-none transition-colors duration-150">←</button>
        <h2 className="font-bold text-base tracking-tight">{entry.nameZh}</h2>
      </div>
      {loading && <div className="text-muted mt-3">加载中…</div>}
      {stat && (
        <>
          <div className="panel-label mt-3 mb-2">{stat.meta}</div>
          <table className="w-full text-xs mb-3">
            <tbody>
              {stat.rows.map(([k, v]) => (
                <tr key={k} className="border-b border-line">
                  <td className="text-muted pr-3 align-top py-1.5 whitespace-nowrap">{k}</td>
                  <td className="py-1.5">{rich(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {stat.body.map((p, i) => <p key={i} className="mb-2 whitespace-pre-wrap leading-relaxed">{rich(p)}</p>)}
        </>
      )}
      <div className="mt-4 flex gap-2">
        {role !== 'spectator' && (
          <button
            onClick={() => connection.sendOps([{ op: 'addFavorite', favorite: { type: entry.type, entryId: entry.id } }])}
            className="btn-quiet flex-1"
          >{fav ? '已收藏' : '★ 收藏'}</button>
        )}
        {role === 'dm' && entry.type === 'monster' && (
          <button
            onClick={() => setPending({
              kind: 'monster', name: entry.nameZh, entryId: entry.id,
              avatar: `/api/token/${entry.id}`, color: '#fff',
            })}
            className="btn-accent flex-1"
          >拿起放置</button>
        )}
        {role === 'player' && entry.type !== 'monster' && (
          <button
            onClick={() => { void api.addCharacterEntry({ type: entry.type, entryId: entry.id, name: entry.nameZh, source: stat?.meta ?? '' }).then(() => setAdded(true)); }}
            className="btn-primary flex-1"
          >{added ? '已加入角色卡' : '加入角色卡'}</button>
        )}
      </div>
    </div>
  );
}
