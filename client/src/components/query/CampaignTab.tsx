import { connection } from '../../ws';
import { setPending } from '../../pending';
import type { QuerySceneState } from './types';
import type { useSceneDirectory } from './useSceneDirectory';

type Props = QuerySceneState & { directory: ReturnType<typeof useSceneDirectory> };

export default function CampaignTab({ role, campaign, directory }: Props) {
  const { sceneNames, unlockedScenes, preview, openPreview, closePreview } = directory;
  return (
    <div className="flex-1 overflow-y-auto">
      {role === 'dm' && (
        <>
          <div className="px-3 py-1.5 panel-label bg-well border-b border-line">敌人 <span className="tabular-nums">({campaign?.enemies.length ?? 0})</span></div>
          {(campaign?.enemies ?? []).map(e => (
            <div key={e.entryId} className="group flex items-center gap-2 px-3 py-1.5 border-b border-line hover:bg-well transition-colors duration-150">
              <img src={`/api/token/${encodeURIComponent(e.entryId)}`} alt="" className="w-6 h-6 border border-line bg-well shrink-0" />
              <span className="flex-1 truncate text-ink">{e.nameZh}</span>

              <button onClick={() => setPending({ kind: 'monster', name: e.nameZh, entryId: e.entryId, avatar: `/api/token/${encodeURIComponent(e.entryId)}`, color: '#fff' })}
                title="拿起放置" className="btn-xs">放置</button>
              <button onClick={() => connection.sendOps([{ op: 'removeEnemy', entryId: e.entryId }])}
                title="移出战役库" className="shrink-0 w-6 h-6 inline-flex items-center justify-center text-xs text-faint hover:text-accent transition-colors duration-150">✕</button>
            </div>
          ))}
          {(campaign?.enemies.length ?? 0) === 0 && <div className="p-3 text-muted text-xs">战役库为空，搜索怪物后点「入库」</div>}
        </>
      )}
      {role === 'player' && (
        <>
          <div className="px-3 py-1.5 panel-label bg-well border-b border-line">DM 解锁的场景</div>
          {unlockedScenes.map(sid => (
            <button key={sid} onClick={() => openPreview(sid)}
              className="w-full text-left px-3 py-1.5 border-b border-line hover:bg-well text-ink transition-colors duration-150">
              {sceneNames[sid]?.name ?? sid}
            </button>
          ))}
          {unlockedScenes.length === 0 && (
            <div className="p-3 text-muted text-xs">暂无 DM 解锁的场景</div>
          )}
        </>
      )}
      {preview && (
        <div className="absolute inset-0 z-20 bg-panel overflow-y-auto p-3">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-ink">
            <button onClick={() => closePreview()} className="text-muted hover:text-accent text-lg leading-none">←</button>
            <h3 className="font-bold">{preview.name}</h3>
            <span className="text-xs text-accent ml-auto">只读预览</span>
          </div>
          {preview.mapImage ? (
            <img src={preview.mapImage} alt="" className="w-full border border-line" />
          ) : (
            <div className="p-3 text-muted text-xs">该场景无地图</div>
          )}
          <div className="mt-3 panel-label mb-1">Token</div>
          <ul className="text-xs text-ink space-y-0.5">
            {preview.tokens.map(t => <li key={t.id}>· {t.name}{t.number != null ? ` #${t.number}` : ''}</li>)}
            {preview.players.map(p => <li key={p.id}>· {p.name}（玩家）</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
