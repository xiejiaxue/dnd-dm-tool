const TOOLS = [
  { id: 'select', label: '选择', icon: '🖱' },
  { id: 'add', label: '放置', icon: '➕' },
  { id: 'wall', label: '画墙', icon: '🧱' },
  { id: 'grid', label: '网格开关', icon: '⊞' },
  { id: 'map', label: '地图', icon: '🗺' },
  { id: 'zoom', label: '缩放', icon: '🔍' },
] as const;

interface Props {
  role?: 'dm' | 'player';
  tool: string;
  onTool: (t: string) => void;
  pendingLabel?: string | null;
  gridShow?: boolean;
  onToggleGrid?: () => void;
}

export default function Toolbar({ role = 'dm', tool, onTool, pendingLabel, gridShow = true, onToggleGrid }: Props) {
  const visible = role === 'dm' ? TOOLS : TOOLS.filter(t => t.id === 'select' || t.id === 'zoom');
  return (
    <aside className="w-12 border-r border-zinc-700/60 bg-zinc-900 flex flex-col items-center py-2 gap-1">
      {visible.map(t => {
        // The grid button is a toggle, not a mode: shows/hides the grid overlay.
        if (t.id === 'grid') {
          return (
            <button key={t.id} title={`${gridShow ? '隐藏' : '显示'}网格`}
              onClick={onToggleGrid}
              className={`w-9 h-9 rounded-md flex items-center justify-center text-lg ${gridShow ? 'bg-amber-600/30 text-amber-400' : 'hover:bg-zinc-700 text-zinc-600'}`}>
              {t.icon}
            </button>
          );
        }
        return (
          <button key={t.id} title={t.label}
            onClick={() => onTool(t.id)}
            className={`w-9 h-9 rounded-md flex items-center justify-center text-lg ${tool === t.id ? 'bg-amber-600/30 text-amber-400' : 'hover:bg-zinc-700 text-zinc-300'}`}>
            {t.icon}
          </button>
        );
      })}
      {pendingLabel && <div className="mt-2 text-[10px] text-amber-400 text-center leading-tight px-1">{pendingLabel}</div>}
    </aside>
  );
}
