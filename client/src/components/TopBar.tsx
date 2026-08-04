import { useRef, useState, type ChangeEvent } from 'react';
import { api } from '../api';
import { connection, useScene } from '../ws';
import { uploadImage } from '../upload';
import SceneSwitcher from './SceneSwitcher';

export default function TopBar() {
  const { scene, role, online } = useScene();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isDm = role === 'dm';

  const onMapPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const url = await uploadImage(file, 'map');
      const img = new Image();
      img.onload = () => {
        connection.sendOps([{
          op: 'updateMap',
          mapImage: url,
          mapSize: [img.naturalWidth, img.naturalHeight],
          playArea: { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight },
        }]);
      };
      img.src = url;
    } catch (err) {
      console.warn('[upload]', err);
    }
  };

  const onUpgrade = async () => {
    setPwMsg(null);
    const ok = await api.verifyPassword(pw).catch(() => false);
    if (!ok) {
      setPwMsg('口令错误，或服务器未设置口令');
      return;
    }
    connection.setDmToken(pw);
    location.reload(); // reconnect with the token so the server grants DM
  };

  return (
    <header className="h-11 flex items-center gap-3 px-3 border-b border-zinc-700/60 bg-zinc-900 text-sm relative">
      <span className="font-semibold">⚙ DM 追踪</span>
      <span className="text-zinc-500 truncate">场景「{scene?.name ?? '连接中…'}」</span>
      <div className="ml-auto flex items-center gap-3 text-zinc-400">
        <span>玩家在线: <span className="text-emerald-400">{online}</span></span>
        {isDm && (
          <>
            <button
              onClick={() => fileRef.current?.click()}
              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
              title="上传地图底图"
            >🗺 上传地图</button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onMapPicked} />
            <button
              onClick={() => setSwitcherOpen(o => !o)}
              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            >切换场景▾</button>
          </>
        )}
        <button
          onClick={() => { setSettingsOpen(o => !o); setSwitcherOpen(false); }}
          className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
        >⚙ 设置</button>
      </div>

      {switcherOpen && <SceneSwitcher onClose={() => setSwitcherOpen(false)} />}

      {settingsOpen && (
        <div className="absolute top-11 right-0 z-20 w-72 bg-zinc-800 border border-zinc-700 rounded shadow-xl p-3 text-sm">
          <div className="text-xs text-zinc-500 mb-2">
            当前角色：<span className={isDm ? 'text-amber-400' : 'text-emerald-400'}>{isDm ? 'DM' : '玩家'}</span>
          </div>
          {!isDm && (
            <>
              <div className="text-xs text-zinc-500 mb-1">输入 DM 口令以升级权限：</div>
              <div className="flex gap-1">
                <input
                  value={pw}
                  onChange={e => setPw(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') onUpgrade(); }}
                  type="password"
                  placeholder="DM 口令"
                  className="flex-1 bg-zinc-900 rounded px-2 py-1 text-sm"
                />
                <button
                  onClick={onUpgrade}
                  className="px-2 py-1 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30"
                >升级</button>
              </div>
              {pwMsg && <div className="mt-1 text-xs text-red-400">{pwMsg}</div>}
            </>
          )}
          {isDm && <div className="text-xs text-zinc-500">DM 拥有全部编辑权限，玩家可拖拽 token 并提交先攻。</div>}
        </div>
      )}
    </header>
  );
}
