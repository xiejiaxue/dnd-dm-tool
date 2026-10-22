import { connection } from '../../ws';
import type { IndexEntry } from '../../types';
import { spawnEnemy } from './actions';
import type { DetailEntry, QuerySceneState } from './types';
import type { useCompendiumSearch } from './useCompendiumSearch';

type Props = QuerySceneState & { search: ReturnType<typeof useCompendiumSearch>; setDetail: (entry: DetailEntry) => void };

export default function CompendiumTab({ scene, role, campaign, search, setDetail }: Props) {
  const { q, results, resultSource } = search;
  const addMonsterToScene = (r: IndexEntry) => spawnEnemy(scene, r.id, r.nameZh);
  const isInLibrary = (entryId: string) => (campaign?.enemies ?? []).some(e => e.entryId === entryId);
  return (
    <div className="flex-1 overflow-y-auto">
      {q.trim() && resultSource === 'online' && (
        <div className="px-3 py-2 text-xs text-muted bg-well border-b border-line border-l-2 border-l-ink">
          本地资料未命中，显示在线 <a href="https://github.com/tjliqy/5etools-cn" target="_blank" rel="noreferrer" className="underline hover:text-ink">5e 不全书（tjliqy/5etools-cn）</a>结果（<a href="https://github.com/tjliqy/5etools-cn/blob/cn2.0/LICENSE.md" target="_blank" rel="noreferrer" className="underline hover:text-ink">CC BY-NC-SA 4.0</a>）。
        </div>
      )}
      {q.trim() && resultSource === 'unavailable' && (
        <div className="px-3 py-2 text-xs text-muted bg-well border-b border-line border-l-2 border-l-accent">
          本地未找到结果，在线资料暂时不可用。
        </div>
      )}
      {results.map(r => (
        <div key={r.id} className="group flex items-center border-b border-line hover:bg-well transition-colors duration-150">
          <button onClick={() => setDetail(r)} className="flex-1 text-left px-3 py-2 min-w-0">
            <span className="block text-ink truncate">{r.nameZh}</span>
            <span className="block text-xs text-muted truncate">{r.nameEn} · {r.source}</span>
          </button>
          <span className="shrink-0 text-xs font-medium text-accent tabular-nums pr-1">
            {r.type === 'monster' ? r.cr ?? '' : r.type === 'spell' ? `${r.level ?? 0} 环` : ''}
          </span>
          {role === 'dm' && r.type === 'monster' && (
            <button
              onClick={() => addMonsterToScene(r)}
              title="添加到场景"
              className="shrink-0 mr-2 ml-1 text-xs font-medium text-accent hover:underline"
            >＋ 添加</button>
          )}
          {role === 'dm' && r.type === 'monster' && (
            <button
              onClick={() => connection.sendOps([{ op: 'addEnemy', entryId: r.id, nameZh: r.nameZh }])}
              title="加入战役库"
              className={`shrink-0 mr-3 ${isInLibrary(r.id) ? 'text-[10px] text-faint' : 'btn-xs'}`}
              disabled={isInLibrary(r.id)}
            >{isInLibrary(r.id) ? '已在库' : '入库'}</button>
          )}
        </div>
      ))}
      {q.trim() && results.length === 0 && resultSource !== 'unavailable' && <div className="p-3 text-muted text-xs">无结果</div>}
    </div>
  );
}
