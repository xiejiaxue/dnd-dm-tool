import { useEffect, useState } from 'react';
import { api } from '../api';
import { connection, useScene } from '../ws';

export default function SceneSwitcher({ onClose }: { onClose: () => void }) {
  const { campaign } = useScene();
  const [scenes, setScenes] = useState<{ id: string; name: string; unlocked: boolean }[]>([]);
  const [name, setName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const reload = () => api.scenes().then(setScenes);
  useEffect(() => { reload(); }, []);
  const visible = scenes.filter(s => (campaign?.sceneIds ?? []).includes(s.id));

  const commitRename = (id: string) => {
    const v = renameValue.trim();
    if (v) connection.sendControl({ type: 'renameScene', sceneId: id, name: v });
    setRenamingId(null);
    setRenameValue('');
    reload();
  };

  return (
    <div className="absolute top-11 right-0 z-20 w-64 bg-zinc-800 border border-zinc-700 rounded shadow-xl p-2 text-sm">
      <div className="text-xs text-zinc-500 mb-1">场景列表</div>
      {visible.map(s => (
        <div key={s.id} className="flex items-center gap-1.5 py-1 px-1 rounded hover:bg-zinc-700">
          {renamingId === s.id ? (
            <input
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onBlur={() => commitRename(s.id)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename(s.id);
                if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
              }}
              className="flex-1 min-w-0 bg-zinc-900 rounded px-2 py-1 text-sm"
            />
          ) : (
            <button
              className="flex-1 min-w-0 text-left truncate"
              onClick={() => { connection.sendControl({ type: 'switchScene', sceneId: s.id }); onClose(); }}
            >{s.name}</button>
          )}
          <button
            title={s.unlocked ? '锁定场景（玩家不可见）' : '解锁场景（玩家可见）'}
            onClick={() => { connection.sendControl({ type: 'updateSceneUnlock', sceneId: s.id, unlocked: !s.unlocked }); reload(); }}
            className={`shrink-0 text-xs ${s.unlocked ? 'text-emerald-400' : 'text-zinc-600 hover:text-zinc-400'}`}
          >{s.unlocked ? '🔓' : '🔒'}</button>
          <button
            className="shrink-0 text-zinc-500 hover:text-amber-400"
            title="重命名场景"
            onClick={() => { setRenamingId(s.id); setRenameValue(s.name); }}
          >✏️</button>
          <button
            className="shrink-0 text-zinc-500 hover:text-red-400"
            title="删除场景"
            onClick={() => { api.deleteScene(s.id).then(reload); }}
          >✕</button>
        </div>
      ))}
      <div className="flex gap-1 mt-2 border-t border-zinc-700 pt-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="新场景名"
          className="flex-1 bg-zinc-900 rounded px-2 py-1 text-sm"
        />
        <button
          onClick={() => {
            if (name.trim()) {
              api.createScene(name.trim()).then(async s => {
                if (campaign) {
                  await api.assignSceneToCampaign(campaign.id, s.id);
                  // 强制服务端重载当前战役并广播，让新场景立即出现在切换器与所有客户端
                  connection.sendControl({ type: 'switchCampaign', campaignId: campaign.id });
                }
                reload();
              });
            }
            setName('');
          }}
          className="px-2 py-1 rounded bg-amber-600/20 text-amber-400"
        >＋</button>
      </div>
    </div>
  );
}
