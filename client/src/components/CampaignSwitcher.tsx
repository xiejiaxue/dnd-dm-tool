import { useEffect, useState } from 'react';
import { api } from '../api';
import { useScene } from '../ws';

export default function CampaignSwitcher({ onClose }: { onClose: () => void }) {
  const { campaign } = useScene();
  const [list, setList] = useState<{ id: string; name: string }[]>([]);
  const reload = () => api.campaigns().then(setList);
  useEffect(() => { reload(); }, []);

  return (
    <div className="absolute top-12 left-0 z-20 w-64 bg-panel border border-ink shadow-[4px_4px_0_0_rgba(17,17,16,0.12)] p-2 text-sm">
      <div className="panel-label mb-1 px-1">战役列表</div>
      {list.map(c => {
        const active = c.id === campaign?.id;
        return (
          <div key={c.id} className="flex items-center gap-2 py-1 px-1 hover:bg-well transition-colors duration-150">
            <button className="flex-1 text-left text-ink" disabled={active} aria-current={active ? 'page' : undefined} onClick={() => {
              if (active) return;
              void api.selectCampaign(c.id).then(() => location.reload());
              onClose();
            }}>
              {c.name}
            </button>
            {active && <span className="text-xs font-bold text-accent">当前</span>}
          </div>
        );
      })}
    </div>
  );
}
