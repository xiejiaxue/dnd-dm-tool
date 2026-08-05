import { useEffect, useState } from 'react';
import { api } from '../api';
import { connection, useScene } from '../ws';

export default function CampaignSwitcher({ onClose }: { onClose: () => void }) {
  const { campaign } = useScene();
  const [list, setList] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState('');
  const reload = () => api.campaigns().then(setList);
  useEffect(() => { reload(); }, []);

  return (
    <div className="absolute top-11 left-0 z-20 w-64 bg-zinc-800 border border-zinc-700 rounded shadow-xl p-2 text-sm">
      <div className="text-xs text-zinc-500 mb-1">战役列表</div>
      {list.map(c => {
        const active = c.id === campaign?.id;
        return (
          <div key={c.id} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-zinc-700">
            <button className="flex-1 text-left" onClick={() => { connection.sendControl({ type: 'switchCampaign', campaignId: c.id }); onClose(); }}>
              {c.name}
            </button>
            <button
              className={active ? 'text-zinc-700 cursor-not-allowed' : 'text-zinc-500 hover:text-red-400'}
              title={active ? '当前战役不可删除' : '删除战役（不删场景）'}
              disabled={active}
              onClick={() => { api.deleteCampaign(c.id).then(reload); }}>✕</button>
          </div>
        );
      })}
      <div className="flex gap-1 mt-2 border-t border-zinc-700 pt-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="新战役名"
          className="flex-1 bg-zinc-900 rounded px-2 py-1 text-sm" />
        <button onClick={() => { if (name.trim()) api.createCampaign(name.trim()).then(reload); setName(''); }}
          className="px-2 py-1 rounded bg-amber-600/20 text-amber-400">＋</button>
      </div>
    </div>
  );
}
