import { useEffect, useState } from 'react';
import { api } from '../api';
import { connection, useScene } from '../ws';
import { preloadDecodedImage } from '../features/assets/imageCache';
import MapUploadButton from '../features/map-upload/MapUploadButton';
import BackupTransfer from './BackupTransfer';
import InvitePlayerButton from './InvitePlayerButton';
import SceneSwitcher from './SceneSwitcher';

interface Props {
  roomName?: string;
  roomSlug?: string;
  onLeaveRoom?: () => void;
}

const roleLabel: Record<string, string> = {
  host: '房主',
  owner: '房主',
  dm: 'DM',
  assistant_dm: '协作 DM',
  co_dm: '协作 DM',
  player: '玩家',
  spectator: '旁观者',
};

export default function TopBar({ roomName, roomSlug, onLeaveRoom }: Props) {
  const { scene, role, roomRole, online, campaign, viewer, viewingInactive } = useScene();
  const [activePopover, setActivePopover] = useState<'invite' | 'backup' | 'scene' | null>(null);
  const isDm = viewer?.canManage === true || role === 'dm';
  const sceneCatalogKey = campaign?.sceneIds.join('\u0000') ?? '';

  // Warm the next visible map after room bootstrap and every scene switch.
  // The previous map is already in the private browser/decoded cache, while
  // limiting speculative work to one map avoids doubling bandwidth for large
  // user uploads. Save-data and 2G users only preload on explicit hover/click.
  useEffect(() => {
    if (!scene?.id || !sceneCatalogKey) return;
    const network = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (network?.saveData || network?.effectiveType === 'slow-2g' || network?.effectiveType === '2g') return;
    let active = true;
    api.scenes().then((scenes) => {
      if (!active) return;
      const index = scenes.findIndex(candidate => candidate.id === scene.id);
      if (index < 0) return;
      const next = scenes[index + 1];
      if (next?.mapImage) void preloadDecodedImage(next.mapImage).catch(() => {});
    }).catch(() => {});
    return () => { active = false; };
  }, [scene?.id, sceneCatalogKey]);

  return (
    <header className="h-11 flex items-center gap-3 px-3 border-b border-zinc-700/60 bg-zinc-900 text-sm relative">
      <span className="font-semibold">⚙ DM 追踪</span>
      <span className="min-w-0 text-zinc-500 truncate">
        房间「{roomName ?? roomSlug ?? '…'}」 / 战役「{campaign?.name ?? '…'}」 / {viewingInactive ? '查看' : '当前场景'}「{scene?.name ?? '连接中…'}」
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-2 text-zinc-400">
        <span className="hidden lg:inline">角色: <span className={isDm || viewer?.canReadAll ? 'text-amber-400' : 'text-emerald-400'}>{viewer?.canReadAll && !isDm ? '平台只读' : roleLabel[roomRole] ?? roomRole}</span></span>
        <span title="当前通过 WebSocket 连接到本房间的玩家数">玩家在线: <span className="text-emerald-400">{online}</span></span>
        {isDm && (
          <>
            <InvitePlayerButton
              open={activePopover === 'invite'}
              onOpenChange={open => setActivePopover(open ? 'invite' : null)}
            />
            {!viewingInactive && <MapUploadButton />}
            <BackupTransfer
              open={activePopover === 'backup'}
              onOpenChange={open => setActivePopover(open ? 'backup' : null)}
            />
            <button
              onClick={() => setActivePopover(current => current === 'scene' ? null : 'scene')}
              aria-expanded={activePopover === 'scene'}
              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 whitespace-nowrap"
            >切换场景▾</button>
            {viewingInactive && <button type="button" onClick={() => connection.viewScene(null)}
              className="whitespace-nowrap rounded bg-sky-500/15 px-2 py-1 text-sky-300 hover:bg-sky-500/25">返回当前场景</button>}
          </>
        )}
        {onLeaveRoom && (
          <button
            onClick={onLeaveRoom}
            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 whitespace-nowrap"
            title="返回房间大厅"
          >返回大厅</button>
        )}
      </div>

      {activePopover === 'scene' && <SceneSwitcher onClose={() => setActivePopover(null)} />}
    </header>
  );
}
