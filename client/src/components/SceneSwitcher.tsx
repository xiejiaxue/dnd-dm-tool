import { useEffect, useState } from 'react';
import { api } from '../api';
import { connection } from '../ws';

export default function SceneSwitcher({ onClose }: { onClose: () => void }) {
  const [scenes, setScenes] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState('');

  const reload = () => api.scenes().then(setScenes);
  useEffect(() => { reload(); }, []);

  return (
    <div className="absolute top-11 right-0 z-20 w-64 bg-zinc-800 border border-zinc-700 rounded shadow-xl p-2 text-sm">
      <div className="text-xs text-zinc-500 mb-1">场景列表</div>
      {scenes.map(s => (
        <div key={s.id} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-zinc-700">
          <button
            className="flex-1 text-left"
            onClick={() => { connection.sendControl({ type: 'switchScene', sceneId: s.id }); onClose(); }}
          >{s.name}</button>
          <button
            className="text-zinc-500 hover:text-red-400"
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
          onClick={() => { if (name.trim()) api.createScene(name.trim()).then(reload); setName(''); }}
          className="px-2 py-1 rounded bg-amber-600/20 text-amber-400"
        >＋</button>
      </div>
    </div>
  );
}
