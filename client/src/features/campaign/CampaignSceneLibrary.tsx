import { useMemo, useState, type FormEvent } from 'react';
import type { Campaign, SceneFolder, Scene } from '../../types';
import { api } from '../../api';
import { connection } from '../../ws';
import { preloadDecodedImage, waitForDecodedImage } from '../assets/imageCache';
import type { SceneCatalogEntry } from './useSceneCatalog';
import ExplorerRow, { ExplorerAction } from '../../components/explorer/ExplorerRow';

export interface CampaignSceneGroup {
  folder: SceneFolder | null;
  sceneIds: string[];
}

/** Stable folder order followed by an optional ungrouped bucket. */
export function groupCampaignScenes(
  sceneIds: readonly string[],
  folders: readonly SceneFolder[],
  assignments: Readonly<Record<string, string>>,
): CampaignSceneGroup[] {
  const validFolderIds = new Set(folders.map(folder => folder.id));
  const grouped = folders.map(folder => ({
    folder,
    sceneIds: sceneIds.filter(sceneId => assignments[sceneId] === folder.id),
  }));
  const ungrouped = sceneIds.filter(sceneId => !validFolderIds.has(assignments[sceneId] ?? ''));
  if (ungrouped.length > 0 || folders.length === 0) grouped.push({ folder: null, sceneIds: ungrouped });
  return grouped;
}

interface Props {
  role: string;
  campaign: Campaign | null;
  catalog: Record<string, SceneCatalogEntry>;
  currentSceneId?: string;
  onPreview: (scene: Scene) => void;
}

export default function CampaignSceneLibrary({ role, campaign, catalog, currentSceneId, onPreview }: Props) {
  const isDm = role === 'dm';
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderName, setFolderName] = useState('');
  const [closedFolders, setClosedFolders] = useState<Set<string>>(() => new Set());
  const [loadingSceneId, setLoadingSceneId] = useState<string | null>(null);

  const visibleSceneIds = useMemo(() => {
    const ids = campaign?.sceneIds ?? [];
    return isDm ? ids : ids.filter(sceneId => catalog[sceneId]?.unlocked);
  }, [campaign?.sceneIds, catalog, isDm]);
  const folders = campaign?.sceneFolders ?? [];
  const assignments = campaign?.sceneFolderAssignments ?? {};
  const groups = useMemo(
    () => groupCampaignScenes(visibleSceneIds, folders, assignments),
    [visibleSceneIds, folders, assignments],
  );

  const createFolder = (event: FormEvent) => {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    connection.sendControl({ type: 'createSceneFolder', name });
    setNewFolderName('');
  };

  const commitFolderName = (folder: SceneFolder) => {
    const name = folderName.trim();
    if (name && name !== folder.name) {
      connection.sendControl({ type: 'renameSceneFolder', folderId: folder.id, name });
    }
    setEditingFolderId(null);
    setFolderName('');
  };

  const toggleFolder = (folderKey: string) => {
    setClosedFolders(current => {
      const next = new Set(current);
      if (next.has(folderKey)) next.delete(folderKey);
      else next.add(folderKey);
      return next;
    });
  };

  const warmScene = (sceneId: string) => {
    const mapImage = catalog[sceneId]?.mapImage;
    if (mapImage) void preloadDecodedImage(mapImage).catch(() => {});
  };

  const openScene = async (sceneId: string) => {
    if (loadingSceneId) return;
    if (!isDm) {
      api.scene(sceneId).then(onPreview).catch(() => {});
      return;
    }
    if (sceneId === currentSceneId) return;
    const mapImage = catalog[sceneId]?.mapImage;
    if (mapImage) {
      setLoadingSceneId(sceneId);
      try { await waitForDecodedImage(mapImage); } catch { /* The board retries after switching. */ }
      setLoadingSceneId(null);
    }
    connection.sendControl({ type: 'switchScene', sceneId });
  };

  if (!campaign) return <div className="p-3 text-xs text-zinc-500">正在读取战役地图…</div>;

  return (
    <section aria-label="战役地图文件夹" className="mt-2 border-t border-zinc-800">
      <div className="flex h-7 items-center gap-2 border-b border-zinc-800 px-2 text-[11px] uppercase tracking-wide text-zinc-500">
        <span className="flex-1">地图场景 ({visibleSceneIds.length})</span>
        {isDm && <span>{folders.length} 个文件夹</span>}
      </div>

      {isDm && (
        <form onSubmit={createFolder} className="flex h-8 gap-1 border-b border-zinc-800/70 px-2 py-1">
          <input
            value={newFolderName}
            onChange={event => setNewFolderName(event.target.value)}
            maxLength={80}
            placeholder="新章节文件夹"
            aria-label="新章节文件夹名称"
            className="min-w-0 flex-1 border border-zinc-700 bg-zinc-950 px-1.5 text-xs outline-none focus:border-amber-500"
          />
          <button
            type="submit"
            disabled={!newFolderName.trim()}
            className="border border-zinc-700 bg-zinc-800 px-2 text-[11px] text-zinc-300 hover:border-zinc-500 hover:bg-zinc-700 disabled:opacity-40"
          >新建</button>
        </form>
      )}

      {groups.map(group => {
        if (!isDm && group.sceneIds.length === 0) return null;
        const folderKey = group.folder?.id ?? '__ungrouped__';
        const closed = closedFolders.has(folderKey);
        return (
          <div key={folderKey}>
            <ExplorerRow
              depth={0}
              kind="folder"
              expanded={!closed}
              onClick={() => toggleFolder(folderKey)}
              label={group.folder && editingFolderId === group.folder.id ? (
                <input
                  autoFocus
                  value={folderName}
                  onClick={event => event.stopPropagation()}
                  onChange={event => setFolderName(event.target.value)}
                  onBlur={() => commitFolderName(group.folder!)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') {
                      setFolderName(group.folder!.name);
                      event.currentTarget.blur();
                    }
                  }}
                  maxLength={80}
                  aria-label="修改文件夹名称"
                  className="h-5 w-full border border-amber-500/70 bg-zinc-900 px-1 text-xs outline-none"
                />
              ) : <>{group.folder?.name ?? '未分组'} <span className="text-zinc-600">{group.sceneIds.length}</span></>}
              actions={isDm && group.folder && editingFolderId !== group.folder.id ? (
                <>
                  <ExplorerAction label="F2" title="重命名文件夹" onClick={() => { setEditingFolderId(group.folder!.id); setFolderName(group.folder!.name); }} />
                  <ExplorerAction label="×" title="删除文件夹；地图会移到未分组" danger onClick={() => {
                    if (confirm(`删除文件夹“${group.folder!.name}”？其中地图会移到“未分组”。`)) {
                      connection.sendControl({ type: 'deleteSceneFolder', folderId: group.folder!.id });
                    }
                  }} />
                </>
              ) : undefined}
            />

            {!closed && group.sceneIds.map(sceneId => {
              const entry = catalog[sceneId];
              return (
                <div key={sceneId} onPointerEnter={() => warmScene(sceneId)} onFocus={() => warmScene(sceneId)}>
                  <ExplorerRow
                    depth={1}
                    kind="file"
                    active={sceneId === currentSceneId}
                    onClick={() => { void openScene(sceneId); }}
                    title={entry?.name ?? sceneId}
                    label={<>{entry?.name ?? sceneId}{loadingSceneId === sceneId ? ' · 加载中…' : ''}</>}
                    actions={isDm ? (
                    <select
                      value={assignments[sceneId] ?? ''}
                      onChange={event => connection.sendControl({
                        type: 'moveSceneToFolder',
                        sceneId,
                        folderId: event.target.value || null,
                      })}
                      aria-label={`移动${entry?.name ?? sceneId}到文件夹`}
                      title="移动到章节文件夹"
                      onClick={event => event.stopPropagation()}
                      className="h-5 max-w-24 border border-zinc-700 bg-zinc-950 px-1 text-[10px] text-zinc-400 outline-none hover:border-zinc-500"
                    >
                      <option value="">未分组</option>
                      {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                    </select>) : undefined}
                  />
                </div>
              );
            })}
            {!closed && group.sceneIds.length === 0 && isDm && (
              <ExplorerRow depth={1} kind="file" muted label="空文件夹" />
            )}
          </div>
        );
      })}

      {visibleSceneIds.length === 0 && (
        <div className="p-3 text-xs text-zinc-500">{isDm ? '暂无地图场景' : '暂无 DM 解锁的场景'}</div>
      )}
    </section>
  );
}
