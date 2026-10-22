import { connection } from '../../ws';
import type { Scene } from '../../types';
import type { DetailEntry, QuerySceneState } from './types';

interface Props { favorites: Scene['favorites']; favNames: Record<string, string>; role: QuerySceneState['role']; setDetail: (entry: DetailEntry) => void }

export default function FavoritesTab({ favorites, favNames, role, setDetail }: Props) {
  return (
    <div className="flex-1 overflow-y-auto">
      {favorites.length === 0 && <div className="p-3 text-muted text-xs">收藏夹为空，从查询中点击 ★ 收藏</div>}
      {favorites.map(f => {
        const zh = favNames[f.entryId] ?? f.entryId;
        return (
          <button key={`${f.type}-${f.entryId}`}
            onClick={() => setDetail({ type: f.type, id: f.entryId, nameZh: zh })}
            className="w-full text-left px-3 py-2 border-b border-line flex justify-between items-center hover:bg-well transition-colors duration-150">
            <span>
              <span className="block text-ink">{zh}</span>
              <span className="block text-xs text-muted">{f.entryId}</span>
            </span>
            {role !== 'spectator' && (
              <button className="text-faint hover:text-accent shrink-0 transition-colors duration-150"
                onClick={(e) => { e.stopPropagation(); connection.sendOps([{ op: 'removeFavorite', type: f.type, entryId: f.entryId }]); }}>✕</button>
            )}
          </button>
        );
      })}
    </div>
  );
}
