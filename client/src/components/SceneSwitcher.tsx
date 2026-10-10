import { useEffect, useState } from 'react';
import { api } from '../api';
import { connection, useScene } from '../ws';

export default function SceneSwitcher({ onClose }: { onClose: () => void }) {
  const { campaign, scene } = useScene();
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
    <div className="absolute top-12 right-0 z-20 w-64 max-h-[70vh] overflow-y-auto bg-panel border border-ink shadow-[4px_4px_0_0_rgba(17,17,16,0.12)] p-2 text-sm">
      <div className="campaign-scene-heading"><span className="panel-label">场景</span><button onClick={onClose} aria-label="关闭场景管理">×</button></div>
      {visible.map(s => (
        <div key={s.id} className="flex items-center gap-1.5 py-1 px-1 hover:bg-well transition-colors duration-150">
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
              className="field-sm flex-1 min-w-0"
            />
          ) : (
            <button
              className="flex-1 min-w-0 text-left truncate text-ink"
              disabled={s.id === scene?.id}
              aria-current={s.id === scene?.id ? 'page' : undefined}
              onClick={() => { connection.sendControl({ type: 'switchScene', sceneId: s.id }); onClose(); }}
            >{s.name}</button>
          )}
          <button
            title={s.unlocked ? '锁定场景（玩家不可见）' : '解锁场景（玩家可见）'}
            onClick={() => { connection.sendControl({ type: 'updateSceneUnlock', sceneId: s.id, unlocked: !s.unlocked }); reload(); }}
            className={`shrink-0 text-xs transition-colors duration-150 ${s.unlocked ? 'text-ink font-medium' : 'text-faint hover:text-accent'}`}
          >{s.unlocked ? '已解锁' : '已锁定'}</button>
          <button
            className="shrink-0 text-faint hover:text-accent transition-colors duration-150"
            title="重命名场景"
            onClick={() => { setRenamingId(s.id); setRenameValue(s.name); }}
          >✎</button>
          <button
            className="shrink-0 text-faint hover:text-accent transition-colors duration-150"
            title="删除场景" disabled={visible.length <= 1}
            onClick={() => { api.deleteScene(s.id).then(reload); }}
          >✕</button>
        </div>
      ))}
      <div className="flex gap-1.5 mt-2 border-t border-line pt-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="新场景名" aria-label="新场景名"
          className="field-sm flex-1"
        />
        <button
          onClick={() => {
            if (name.trim()) {
              api.createScene(name.trim()).then(s => {
                // A room has one fixed campaign. The room service adds a new
                // scene to it atomically, then this command selects it.
                connection.sendControl({ type: 'switchScene', sceneId: s.id });
                reload();
              });
            }
            setName('');
          }}
          className="btn-primary" disabled={!name.trim()} aria-label="新建场景"
        >＋</button>
      </div>
    </div>
  );
}
