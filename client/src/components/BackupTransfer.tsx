import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  MAX_BACKUP_BYTES,
  assetAsFile,
  buildSceneBackup,
  downloadSceneBackup,
  importedToken,
  parseSceneBackup,
  type SceneBackup,
} from '../backup';
import { api } from '../api';
import { uploadImage } from '../upload';
import { connection, useScene } from '../ws';
import type { Op } from '../types';

interface PendingImport {
  backup: SceneBackup;
  sceneId: string;
}

type Notice = { tone: 'info' | 'success' | 'error'; text: string };
const MAX_REVEALED_FOG_CELLS = 20_000;

function sendInBatches(operations: Op[], perMessage = 20): void {
  let batch: Op[] = [];
  let bytes = 0;
  for (const operation of operations) {
    const operationBytes = new TextEncoder().encode(JSON.stringify(operation)).byteLength;
    if (batch.length > 0 && (batch.length >= perMessage || bytes + operationBytes > 48 * 1024)) {
      connection.sendOps(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(operation);
    bytes += operationBytes;
  }
  if (batch.length > 0) connection.sendOps(batch);
}

/** The room accepts large `setFog` cell lists, but small command batches keep
 * each WebSocket frame comfortably below the protocol's byte ceiling. */
function restoreFog(fog: boolean[] | undefined, fogReveals: SceneBackup['scene']['fogReveals']): boolean {
  let restored = true;
  const revealed: number[] = [];
  fog?.forEach((isRevealed, index) => { if (isRevealed) revealed.push(index); });
  if (fog?.length === 0 || (!fog && fogReveals?.length)) {
    connection.sendOps([{ op: 'coverAllFog' }]);
  } else if (fog && revealed.length === fog.length) {
    connection.sendOps([{ op: 'revealAllFog' }]);
  } else if (fog) {
    // The room intentionally rate-limits WebSocket commands. Avoid a giant
    // sparse-fog import disconnecting the moderator; the file still preserves
    // that fog data for a future server-side bulk-import endpoint.
    if (revealed.length > MAX_REVEALED_FOG_CELLS) restored = false;
    else {
      connection.sendOps([{ op: 'coverAllFog' }]);
      const cellOperations: Op[] = [];
      for (let start = 0; start < revealed.length; start += 1_000) {
        cellOperations.push({ op: 'setFog', cells: revealed.slice(start, start + 1_000), revealed: true });
      }
      sendInBatches(cellOperations, 4);
    }
  }
  if (fogReveals?.length) {
    sendInBatches(fogReveals.map(rect => ({ op: 'revealFogRect' as const, rect })), 20);
  }
  return restored;
}

async function restoreIntoNewScene(backup: SceneBackup, sceneId: string): Promise<string[]> {
  const warnings: string[] = [];
  let mapImage: string | null = null;
  if (backup.scene.mapAssetId) {
    const asset = backup.assets[backup.scene.mapAssetId];
    try {
      mapImage = await uploadImage(assetAsFile(asset, 'map'), 'map');
    } catch {
      warnings.push('地图素材未能上传');
    }
  }

  const avatarUrls: string[] = [];
  for (const [index, token] of backup.scene.tokens.entries()) {
    if (!token.avatarAssetId) {
      avatarUrls.push('');
      continue;
    }
    const asset = backup.assets[token.avatarAssetId];
    try {
      avatarUrls.push(await uploadImage(assetAsFile(asset, `token-${index + 1}`), 'token'));
    } catch {
      avatarUrls.push('');
      warnings.push(`“${token.name}”的头像未能上传`);
    }
  }

  const { scene } = backup;
  const setup: Op[] = [
    {
      op: 'updateMap',
      mapImage,
      mapSize: scene.mapSize,
      playArea: scene.playArea,
    },
    { op: 'updateMapScale', mapScale: scene.mapScale },
    // `show` is deliberately absent: coordinate snapping is restored without
    // bringing the retired grid overlay back into the imported scene.
    { op: 'updateGrid', patch: { size: scene.grid.size, offset: scene.grid.offset, snap: scene.grid.snap } },
    ...scene.tokens.map((token, index) => ({ op: 'addToken' as const, token: importedToken(token, avatarUrls[index], index) })),
    ...scene.walls.map((wall, index) => ({
      op: 'addWall' as const,
      wall: { id: `import-wall-${index + 1}`, p1: wall.p1, p2: wall.p2 },
    })),
    ...scene.favorites.map(favorite => ({ op: 'addFavorite' as const, favorite })),
    ...(backup.campaign?.enemies ?? []).map(enemy => ({ op: 'addEnemy' as const, entryId: enemy.entryId, nameZh: enemy.nameZh })),
    ...(backup.campaign?.npcs ?? []).map(npc => ({ op: 'upsertNpc' as const, npc })),
  ];
  sendInBatches(setup);
  if (!restoreFog(scene.fog, scene.fogReveals)) warnings.push('迷雾数据过大，已保留在备份文件中但未自动恢复');
  connection.sendControl({ type: 'updateSceneUnlock', sceneId, unlocked: scene.unlocked });
  return warnings;
}

/**
 * Portable browser-side backup UI. Importing always creates a new scene, so a
 * malformed/local file cannot overwrite a live battle by accident.
 */
export default function BackupTransfer() {
  const { scene, campaign, role } = useScene();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedSceneId = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingImport || scene?.id !== pendingImport.sceneId || startedSceneId.current === pendingImport.sceneId) return;
    startedSceneId.current = pendingImport.sceneId;
    void restoreIntoNewScene(pendingImport.backup, pendingImport.sceneId)
      .then(warnings => {
        setNotice({
          tone: warnings.length ? 'info' : 'success',
          text: warnings.length
            ? `已导入新场景；${warnings.slice(0, 2).join('，')}${warnings.length > 2 ? '等素材请重新上传。' : '。'}`
            : '已导入为一个新场景。',
        });
      })
      .catch(error => {
        setNotice({ tone: 'error', text: error instanceof Error ? `导入失败：${error.message}` : '导入失败' });
      })
      .finally(() => {
        setBusy(false);
        setPendingImport(null);
      });
  }, [pendingImport, scene?.id]);

  if (role !== 'dm') return null;

  const exportScene = async () => {
    if (!scene || busy) return;
    setBusy(true);
    setNotice({ tone: 'info', text: '正在打包当前场景和已上传的图片…' });
    try {
      const { backup, skippedAssetCount } = await buildSceneBackup(scene, campaign);
      downloadSceneBackup(backup);
      setNotice({
        tone: skippedAssetCount ? 'info' : 'success',
        text: skippedAssetCount
          ? `备份已下载；${skippedAssetCount} 个图片素材无法读取，导入后需要重新上传。`
          : '备份已下载，地图和怪物头像已嵌入文件。',
      });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? `导出失败：${error.message}` : '导出失败' });
    } finally {
      setBusy(false);
    }
  };

  const importScene = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    if (file.size > MAX_BACKUP_BYTES) {
      setNotice({ tone: 'error', text: '备份文件超过 60 MiB 安全上限。' });
      return;
    }
    setBusy(true);
    setNotice({ tone: 'info', text: '正在验证备份并创建新场景…' });
    try {
      const backup = parseSceneBackup(await file.text());
      const imported = await api.createScene(`${backup.scene.name}（导入）`);
      startedSceneId.current = null;
      setPendingImport({ backup, sceneId: imported.id });
      connection.sendControl({ type: 'switchScene', sceneId: imported.id });
    } catch (error) {
      setBusy(false);
      setNotice({ tone: 'error', text: error instanceof Error ? `无法导入：${error.message}` : '无法导入备份文件' });
    }
  };

  const toneClass = notice?.tone === 'error'
    ? 'text-red-300'
    : notice?.tone === 'success'
      ? 'text-emerald-300'
      : 'text-zinc-400';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50 whitespace-nowrap"
        title="导入或导出当前场景的本地备份文件"
        aria-expanded={open}
        disabled={busy}
      >{busy ? '备份处理中…' : '导入/导出'}</button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json,.dnd.json"
        className="hidden"
        onChange={(event) => { void importScene(event); }}
      />
      {open && (
        <div className="absolute right-0 top-9 z-30 w-80 rounded border border-zinc-700 bg-zinc-800 p-3 text-xs shadow-xl">
          <div className="font-medium text-zinc-200">本地场景备份</div>
          <p className="mt-1 leading-relaxed text-zinc-400">导出当前场景为文件；导入时会新建场景，不会覆盖正在进行的战斗。</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { void exportScene(); }}
              disabled={!scene || busy}
              className="rounded bg-emerald-600/20 px-2 py-2 text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-50"
            >导出当前场景</button>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="rounded bg-amber-600/20 px-2 py-2 text-amber-300 hover:bg-amber-600/30 disabled:opacity-50"
            >导入为新场景</button>
          </div>
          <p className="mt-3 leading-relaxed text-zinc-500">地图、怪物与迷雾会恢复（超大迷雾除外）；玩家身份与当前先攻顺序属于房间实时状态，出于权限安全不会导入。</p>
          {notice && <p className={`mt-2 leading-relaxed ${toneClass}`} role="status">{notice.text}</p>}
        </div>
      )}
    </div>
  );
}
