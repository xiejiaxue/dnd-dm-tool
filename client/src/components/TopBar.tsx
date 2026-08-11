import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api } from '../api';
import { connection, useScene } from '../ws';
import { uploadImage } from '../upload';
import BackupTransfer from './BackupTransfer';
import SceneSwitcher from './SceneSwitcher';
import CampaignSwitcher from './CampaignSwitcher';

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
  const { scene, role, roomRole, online, campaign } = useScene();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [campaignSwitcherOpen, setCampaignSwitcherOpen] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [uploadingMap, setUploadingMap] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mapUploadGeneration = useRef(0);
  const mapPreviewCleanup = useRef<(() => void) | null>(null);
  const mapPreviewUrl = useRef<string | null>(null);
  const isDm = role === 'dm';

  const clearMapPreview = () => {
    mapPreviewCleanup.current?.();
    mapPreviewCleanup.current = null;
    if (mapPreviewUrl.current) URL.revokeObjectURL(mapPreviewUrl.current);
    mapPreviewUrl.current = null;
  };

  useEffect(() => () => { clearMapPreview(); }, []);

  const onMapPicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const uploadGeneration = ++mapUploadGeneration.current;
    clearMapPreview();
    setUploadingMap(true);
    const previewUrl = URL.createObjectURL(file);
    const image = new Image();
    try {
      const dimensions = await new Promise<[number, number]>((resolve, reject) => {
        image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
        image.onerror = () => reject(new Error('无法读取地图图片'));
        image.src = previewUrl;
      });
      if (uploadGeneration !== mapUploadGeneration.current) {
        URL.revokeObjectURL(previewUrl);
        return;
      }
      const [width, height] = dimensions;
      const operation = {
        op: 'updateMap' as const,
        mapImage: previewUrl,
        mapSize: [width, height] as [number, number],
        playArea: { x: 0, y: 0, w: width, h: height },
      };
      mapPreviewUrl.current = previewUrl;
      mapPreviewCleanup.current = connection.previewOps([operation]);

      const url = await uploadImage(file, 'map');
      if (uploadGeneration !== mapUploadGeneration.current) return;
      // Publish only the R2 URL to other members; the blob preview never
      // leaves this browser and disappears as soon as the durable op is sent.
      clearMapPreview();
      connection.sendOps([{ ...operation, mapImage: url }]);
    } catch (error) {
      if (uploadGeneration === mapUploadGeneration.current) {
        const ownsPreview = mapPreviewUrl.current === previewUrl;
        clearMapPreview();
        if (!ownsPreview) URL.revokeObjectURL(previewUrl);
        setInviteMessage(error instanceof Error ? `上传失败：${error.message}` : '上传失败');
      }
    } finally {
      if (uploadGeneration === mapUploadGeneration.current) setUploadingMap(false);
    }
  };

  const createInvite = async () => {
    if (creatingInvite) return;
    setCreatingInvite(true);
    setInviteMessage(null);
    try {
      const invite = await api.createInvite({ role: 'player' });
      const token = invite.token;
      const rawUrl = invite.inviteUrl || invite.url || (token ? `/#invite=${encodeURIComponent(token)}` : '');
      if (!rawUrl) throw new Error('服务未返回邀请链接');
      const url = new URL(rawUrl, location.origin).toString();
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(url);
        setInviteMessage('玩家邀请链接已复制，可以发给朋友。');
      } catch {
        setInviteMessage(`邀请链接：${url}`);
      }
    } catch (error) {
      setInviteMessage(error instanceof Error ? `创建邀请失败：${error.message}` : '创建邀请失败');
    } finally {
      setCreatingInvite(false);
    }
  };

  return (
    <header className="h-11 flex items-center gap-3 px-3 border-b border-zinc-700/60 bg-zinc-900 text-sm relative">
      <span className="font-semibold">⚙ DM 追踪</span>
      <span className="text-zinc-500 truncate">
        房间「{roomName ?? roomSlug ?? '…'}」 / 战役「{campaign?.name ?? '…'}」 / 场景「{scene?.name ?? '连接中…'}」
      </span>
      <div className="ml-auto flex items-center gap-3 text-zinc-400">
        <span className="hidden lg:inline">角色: <span className={isDm ? 'text-amber-400' : 'text-emerald-400'}>{roleLabel[roomRole] ?? roomRole}</span></span>
        <span>在线: <span className="text-emerald-400">{online}</span></span>
        {isDm && (
          <>
            <button
              onClick={() => { void createInvite(); }}
              disabled={creatingInvite}
              className="px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 disabled:opacity-50"
              title="创建一个只能加入此房间的玩家邀请链接"
            >{creatingInvite ? '创建中…' : '邀请玩家'}</button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadingMap}
              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
              title="上传地图底图"
            >{uploadingMap ? '上传地图…' : '🗺 上传地图'}</button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onMapPicked} />
            <BackupTransfer />
            <button
              onClick={() => setCampaignSwitcherOpen(open => !open)}
              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            >切换战役▾</button>
            <button
              onClick={() => setSwitcherOpen(open => !open)}
              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            >切换场景▾</button>
          </>
        )}
        {onLeaveRoom && (
          <button
            onClick={onLeaveRoom}
            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            title="返回房间大厅"
          >房间</button>
        )}
      </div>

      {switcherOpen && <SceneSwitcher onClose={() => setSwitcherOpen(false)} />}
      {campaignSwitcherOpen && <CampaignSwitcher onClose={() => setCampaignSwitcherOpen(false)} />}
      {inviteMessage && (
        <div className="absolute top-12 right-3 z-30 max-w-md rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs shadow-xl text-zinc-200">
          <button onClick={() => setInviteMessage(null)} className="float-right ml-3 text-zinc-500 hover:text-white" aria-label="关闭">✕</button>
          {inviteMessage}
        </div>
      )}
    </header>
  );
}
