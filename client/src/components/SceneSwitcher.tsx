import { useCallback, useEffect, useState } from 'react';
import { api, type WaterdeepDeploymentResult } from '../api';
import { connection, useScene } from '../ws';

export default function SceneSwitcher({ onClose }: { onClose: () => void }) {
  const { campaign, scene, role, revision, connected } = useScene();
  const [deployment, setDeployment] = useState<WaterdeepDeploymentResult | null>(null);
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployError, setDeployError] = useState('');
  const loadDeployment = async (apply: boolean) => {
    setDeployBusy(true); setDeployError('');
    try { setDeployment(await (apply ? api.deployWaterdeep() : api.previewWaterdeepDeployment())); }
    catch (error) { setDeployError(error instanceof Error ? error.message : '部署失败'); }
    finally { setDeployBusy(false); }
  };
  const [scenes, setScenes] = useState<{ id: string; name: string; unlocked: boolean }[]>([]);
  const [name, setName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [actionError, setActionError] = useState('');

  const fail = (error: unknown, fallback: string) => setActionError(error instanceof Error ? error.message : fallback);
  const reload = useCallback(() => api.scenes().then(setScenes).catch(error => fail(error, '读取场景失败')), []);
  // Rename, unlock and switch go over the socket; re-read the list once the
  // room has applied them (the revision changes) rather than racing the command.
  useEffect(() => { void reload(); }, [reload, revision]);
  // A rejected rename/unlock leaves no new revision; drop the optimistic copy.
  useEffect(() => connection.onMessage(msg => { if (msg.type === 'error') void reload(); }), [reload]);
  const visible = scenes.filter(s => (campaign?.sceneIds ?? []).includes(s.id));

  const control = (message: Record<string, unknown>) => {
    if (connection.sendControl(message)) { setActionError(''); return true; }
    setActionError('连接已断开，重连后再试');
    return false;
  };
  const patchScene = (id: string, patch: Partial<{ name: string; unlocked: boolean }>) =>
    setScenes(list => list.map(item => item.id === id ? { ...item, ...patch } : item));

  const commitRename = (id: string) => {
    const v = renameValue.trim();
    if (v && control({ type: 'renameScene', sceneId: id, name: v })) patchScene(id, { name: v });
    setRenamingId(null);
    setRenameValue('');
  };

  return (
    <div className="absolute top-12 right-0 z-20 w-64 max-h-[70vh] overflow-y-auto bg-panel border border-ink shadow-[4px_4px_0_0_rgba(17,17,16,0.12)] p-2 text-sm">
      <div className="campaign-scene-heading"><span className="panel-label">场景</span><button onClick={onClose} aria-label="关闭场景管理">×</button></div>
      {role === 'dm' && visible.some(s => s.name.includes('地图8.1')) && <div className="border-b border-line py-2 mb-2">
        <button className="btn-xs" disabled={deployBusy} onClick={() => loadDeployment(false)}>预览深水城Token部署</button>
        {deployError && <p role="alert">{deployError}</p>}
        {deployment && <div className="text-xs mt-2" aria-live="polite">
          <p>{deployment.applied ? '部署完成：新增' : '预览：待新增'} {deployment.added} 个隐藏Token。保留已有单位、HP与先攻。</p>
          {!deployment.applied && <button className="btn-primary my-2" disabled={deployBusy || deployment.added === 0} onClick={() => loadDeployment(true)}>部署全部场景隐藏Token</button>}
          {deployment.rows.map(row => <details key={row.scene} className="py-1 border-b border-line"><summary>{row.scene}：已有{row.existing}／新增{row.added}</summary><p>{row.note}</p><p>场景合计{row.total}；已隐藏{row.hidden}</p></details>)}
        </div>}
      </div>}
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
              disabled={s.id === scene?.id || !connected}
              aria-current={s.id === scene?.id ? 'page' : undefined}
              onClick={() => { if (control({ type: 'switchScene', sceneId: s.id })) onClose(); }}
            >{s.name}</button>
          )}
          <button
            title={s.unlocked ? '锁定场景（玩家不可见）' : '解锁场景（玩家可见）'}
            disabled={!connected}
            onClick={() => { if (control({ type: 'updateSceneUnlock', sceneId: s.id, unlocked: !s.unlocked })) patchScene(s.id, { unlocked: !s.unlocked }); }}
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
            onClick={() => { api.deleteScene(s.id).then(reload, error => fail(error, '删除场景失败')); }}
          >✕</button>
        </div>
      ))}
      {actionError && <p role="alert" className="mt-2 text-xs text-accent">{actionError}</p>}
      <div className="flex gap-1.5 mt-2 border-t border-line pt-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="新场景名" aria-label="新场景名"
          className="field-sm flex-1"
        />
        <button
          onClick={() => {
            const value = name.trim();
            if (!value) return;
            api.createScene(value).then(s => {
              // A room has one fixed campaign. The room service adds a new
              // scene to it atomically, then this command selects it.
              setName('');
              control({ type: 'switchScene', sceneId: s.id });
              void reload();
            }, error => fail(error, '新建场景失败'));
          }}
          className="btn-primary" disabled={!name.trim()} aria-label="新建场景"
        >＋</button>
      </div>
    </div>
  );
}
