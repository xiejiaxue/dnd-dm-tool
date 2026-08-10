import { Fragment } from 'react';

const TOOLS = [
  { id: 'select', label: '选择', icon: '🖱' },
  { id: 'add', label: '放置', icon: '➕' },
  { id: 'wall', label: '画墙', icon: '🧱' },
  { id: 'erase', label: '擦除', icon: '🧽' },
  { id: 'map', label: '地图', icon: '🗺' },
  { id: 'zoom', label: '缩放', icon: '🔍' },
] as const;

interface Props {
  role?: 'dm' | 'player' | 'spectator';
  tool: string;
  onTool: (t: string) => void;
  pendingLabel?: string | null;
  // Eraser brush size (0 = 小, 1 = 中, 2 = 大). Only meaningful while the erase
  // tool is active; rendered as a small selector under the erase button.
  brushSize?: number;
  onBrushSize?: (n: number) => void;
}

export default function Toolbar({ role = 'dm', tool, onTool, pendingLabel, brushSize = 0, onBrushSize }: Props) {
  const visible = role === 'dm' ? TOOLS : TOOLS.filter(t => t.id === 'select' || t.id === 'zoom');
  return (
    <aside className="w-12 border-r border-zinc-700/60 bg-zinc-900 flex flex-col items-center py-2 gap-1">
      {visible.map(t => (
        <Fragment key={t.id}>
          <button title={t.label}
            onClick={() => onTool(t.id)}
            className={`w-9 h-9 rounded-md flex items-center justify-center text-lg ${tool === t.id ? 'bg-amber-600/30 text-amber-400' : 'hover:bg-zinc-700 text-zinc-300'}`}>
            {t.icon}
          </button>
          {/* Brush-size selector, shown under the erase button while active. */}
          {t.id === 'erase' && tool === 'erase' && (
            <div className="flex flex-col items-center gap-0.5 mt-1">
              {[0, 1, 2].map(r => (
                <button key={r} onClick={() => onBrushSize?.(r)}
                  className={`w-7 h-6 rounded text-[10px] ${brushSize === r ? 'bg-amber-600/30 text-amber-400' : 'text-zinc-500 hover:bg-zinc-700'}`}>
                  {['小', '中', '大'][r]}
                </button>
              ))}
            </div>
          )}
        </Fragment>
      ))}
      {pendingLabel && <div className="mt-2 text-[10px] text-amber-400 text-center leading-tight px-1">{pendingLabel}</div>}
    </aside>
  );
}
