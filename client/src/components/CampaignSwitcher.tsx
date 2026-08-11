import { useEffect, useState } from 'react';
import { api } from '../api';
import { useScene } from '../ws';

export default function CampaignSwitcher({ onClose }: { onClose: () => void }) {
  const { campaign } = useScene();
  const [list, setList] = useState<{ id: string; name: string }[]>([]);
  const reload = () => api.campaigns().then(setList);
  useEffect(() => { reload(); }, []);

  return (
    <div className="absolute top-11 left-0 z-20 w-64 bg-zinc-800 border border-zinc-700 rounded shadow-xl p-2 text-sm">
      <div className="text-xs text-zinc-500 mb-1">战役列表</div>
      {list.map(c => {
        const active = c.id === campaign?.id;
        return (
          <div key={c.id} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-zinc-700">
            <button className="flex-1 text-left" onClick={() => {
              if (active) return;
              void api.selectCampaign(c.id).then(() => location.reload());
              onClose();
            }}>
              {c.name}
            </button>
            {active && <span className="text-xs text-emerald-400">当前</span>}
          </div>
        );
      })}
    </div>
  );
}
