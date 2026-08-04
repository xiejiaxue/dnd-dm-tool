import { useRef, useState, type ChangeEvent } from 'react';
import { connection, useScene } from '../ws';
import { uploadImage } from '../upload';
import SceneSwitcher from './SceneSwitcher';

export default function TopBar() {
  const { scene, role, online } = useScene();
  const [switcherOpen, setSwitcherOpen] = useState(false);
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

  return (
    <header className="h-11 flex items-center gap-3 px-3 border-b border-zinc-700/60 bg-zinc-900 text-sm relative">
      <span className="font-semibold">⚙ DM 追踪</span>
      <span className="text-zinc-500 truncate">场景「{scene?.name ?? '连接中…'}」</span>
      <div className="ml-auto flex items-center gap-3 text-zinc-400">
        <span>玩家在线: <span className="text-emerald-400">{online}</span></span>
        <span>口令: 未设置</span>
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
      </div>
      {switcherOpen && <SceneSwitcher onClose={() => setSwitcherOpen(false)} />}
    </header>
  );
}
