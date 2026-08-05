import { useState } from 'react';
import { connection, useScene } from '../ws';
import DetailDrawer from './DetailDrawer';

// Left-hand panel listing the monster tokens currently in the scene, with
// quick delete (DM) and a detail button that reuses DetailDrawer's stat block.
export default function EnemyList() {
  const { scene, role } = useScene();
  const [detail, setDetail] = useState<{ type: 'monster'; id: string; nameZh: string } | null>(null);
  const tokens = scene?.tokens ?? [];
  const isDm = role === 'dm';

  return (
    <aside className="w-52 border-r border-zinc-700/60 bg-zinc-900 flex flex-col text-sm relative">
      <div className="px-2 py-2 border-b border-zinc-800 text-xs text-zinc-400">
        敌人 <span className="text-zinc-500">({tokens.length})</span>
      </div>
      {detail ? (
        <DetailDrawer entry={detail} onBack={() => setDetail(null)} />
      ) : (
        <div className="flex-1 overflow-y-auto">
          {tokens.map(t => {
            const eid = t.entryId;
            return (
              <div key={t.id} className="flex items-center gap-1 px-2 py-1.5 border-b border-zinc-800/50 hover:bg-zinc-800/50">
                <span className="flex-1 truncate text-zinc-200">{t.name}{t.number != null ? ` #${t.number}` : ''}</span>
                {eid && (
                  <button
                    onClick={() => setDetail({ type: 'monster', id: eid, nameZh: t.name })}
                    title="显示详细数据"
                    className="shrink-0 w-6 h-6 rounded hover:bg-zinc-700 text-zinc-400 hover:text-amber-400"
                  >📖</button>
                )}
                {isDm && (
                  <button
                    onClick={() => connection.sendOps([{ op: 'removeToken', tokenId: t.id }])}
                    title="删除 token"
                    className="shrink-0 w-6 h-6 rounded hover:bg-zinc-700 text-zinc-400 hover:text-red-400"
                  >✕</button>
                )}
              </div>
            );
          })}
          {tokens.length === 0 && <div className="p-3 text-zinc-500 text-xs">暂无敌人 token</div>}
        </div>
      )}
    </aside>
  );
}
