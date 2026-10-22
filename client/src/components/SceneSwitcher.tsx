import { useEffect, useState } from 'react';
import { api, type SceneSummary } from '../api';
import { connection, useScene } from '../ws';
import { preloadDecodedImage, waitForDecodedImage } from '../features/assets/imageCache';
import SceneConfigDialog from '../features/scenes/SceneConfigDialog';
import type { Scene, SceneConfigurationPatch } from '../types';
import { useTabletopSettings } from '../features/settings/TabletopSettingsContext';

export default function SceneSwitcher({ onClose }: { onClose: () => void }) {
  const { campaign, scene, activeSceneId } = useScene();
  const { confirmAction } = useTabletopSettings();
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [name, setName] = useState('');
  const [loadingMapId, setLoadingMapId] = useState<string | null>(null);
  const [configScene, setConfigScene] = useState<Scene | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = () => api.scenes().then(setScenes).catch(cause => setError(message(cause)));
  useEffect(() => { void reload(); }, []);
  const visible = scenes.filter(candidate => (campaign?.sceneIds ?? []).includes(candidate.id));

  const warm = (candidate: SceneSummary) => {
    if (candidate.mapImage) void preloadDecodedImage(candidate.mapImage).catch(() => {});
  };

  const loadScene = async (candidate: SceneSummary): Promise<Scene | null> => {
    if (loadingMapId) return null;
    if (candidate.mapImage) {
      setLoadingMapId(candidate.id);
      try { await waitForDecodedImage(candidate.mapImage); } catch { /* The board retries after navigation. */ }
      setLoadingMapId(null);
    }
    try {
      setError('');
      return await api.scene(candidate.id);
    } catch (cause) {
      setError(message(cause));
      return null;
    }
  };

  const viewScene = async (candidate: SceneSummary) => {
    if (candidate.id === activeSceneId) {
      connection.viewScene(null);
      onClose();
      return;
    }
    const loaded = await loadScene(candidate);
    if (!loaded) return;
    connection.viewScene(loaded);
    onClose();
  };

  const configure = async (candidate: SceneSummary) => {
    const loaded = candidate.id === scene?.id ? scene : await loadScene(candidate);
    if (loaded) setConfigScene(loaded);
  };

  const saveConfiguration = async (patch: SceneConfigurationPatch) => {
    if (!configScene) return;
    setConfigBusy(true);
    try {
      const updated = await api.updateScene(configScene.id, patch);
      if (scene?.id === updated.id && updated.id !== activeSceneId) connection.viewScene(updated);
      setConfigScene(null);
      setError('');
      await reload();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setConfigBusy(false);
    }
  };

  return (
    <>
      <div className="absolute right-0 top-11 z-20 w-80 rounded border border-zinc-700 bg-zinc-800 p-2 text-sm shadow-xl">
        <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
          <span>查看不影响玩家，激活同步全桌</span>
          {scene?.id !== activeSceneId && <button type="button" onClick={() => { connection.viewScene(null); onClose(); }} className="text-emerald-300 hover:text-emerald-200">返回当前</button>}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {visible.map(candidate => {
            const active = candidate.id === activeSceneId;
            const viewed = candidate.id === scene?.id;
            return (
              <div key={candidate.id} className={`flex items-center gap-1 rounded px-1 py-1 ${viewed ? 'bg-zinc-700' : 'hover:bg-zinc-700/60'}`}>
                <button type="button" className="min-w-0 flex-1 truncate text-left" onPointerEnter={() => warm(candidate)} onFocus={() => warm(candidate)}
                  onClick={() => { void viewScene(candidate); }} title={`仅查看 ${candidate.name}`}>
                  {candidate.name}{loadingMapId === candidate.id ? ' · 加载中…' : ''}
                  <span className={`ml-1 text-[10px] ${active ? 'text-emerald-400' : viewed ? 'text-sky-300' : 'text-zinc-600'}`}>{active ? '当前' : viewed ? '查看中' : ''}</span>
                </button>
                {!active && <button type="button" onClick={() => { connection.activateScene(candidate.id); onClose(); }} title="激活并同步给所有玩家"
                  className="rounded bg-emerald-500/10 px-1.5 py-1 text-[10px] text-emerald-300 hover:bg-emerald-500/20">激活</button>}
                <button type="button" onClick={() => { void configure(candidate); }} title="配置场景" aria-label={`配置场景 ${candidate.name}`}
                  className="rounded px-1.5 py-1 text-xs text-zinc-400 hover:bg-zinc-600 hover:text-white">设置</button>
                <button type="button" title={candidate.unlocked ? '锁定场景（玩家不可自行查看）' : '解锁场景（玩家可自行查看）'}
                  aria-label={candidate.unlocked ? `锁定场景 ${candidate.name}` : `解锁场景 ${candidate.name}`}
                  onClick={() => { void api.updateScene(candidate.id, { unlocked: !candidate.unlocked }).then(reload).catch(cause => setError(message(cause))); }}
                  className={`shrink-0 rounded px-1 text-[10px] ${candidate.unlocked ? 'text-emerald-400' : 'text-zinc-500'}`}>{candidate.unlocked ? '公开' : '锁定'}</button>
                <button type="button" className="shrink-0 rounded px-1 text-zinc-500 hover:bg-red-500/10 hover:text-red-400" title="删除场景"
                  aria-label={`删除场景 ${candidate.name}`} onClick={() => {
                    if (!confirmAction(`删除场景“${candidate.name}”？地图、Token、墙体和迷雾都会被删除。此操作无法撤销。`)) return;
                    void api.deleteScene(candidate.id).then(() => {
                      if (scene?.id === candidate.id) connection.viewScene(null);
                      return reload();
                    }).catch(cause => setError(message(cause)));
                  }}>×</button>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex gap-1 border-t border-zinc-700 pt-2">
          <input value={name} onChange={event => setName(event.target.value)} placeholder="新场景名" className="min-w-0 flex-1 rounded bg-zinc-900 px-2 py-1 text-sm" />
          <button type="button" disabled={!name.trim()} aria-label="新建场景" title="新建场景" onClick={() => {
            const next = name.trim();
            if (!next) return;
            setName('');
            void api.createScene(next).then(async created => {
              await reload();
              connection.viewScene(created);
            }).catch(cause => setError(message(cause)));
          }} className="rounded bg-amber-600/20 px-2 py-1 text-amber-400 disabled:cursor-not-allowed disabled:opacity-40">＋</button>
        </div>
        {error && <p className="mt-2 rounded bg-red-950/30 px-2 py-1 text-xs text-red-300">{error}</p>}
      </div>
      {configScene && <SceneConfigDialog scene={configScene} busy={configBusy} error={error} onClose={() => setConfigScene(null)} onSave={patch => { void saveConfiguration(patch); }} />}
    </>
  );
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : '场景操作失败';
}
