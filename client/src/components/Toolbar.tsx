const TOOLS = [
  { id: 'select', label: '选择', icon: '🖱' },
  { id: 'add', label: '放置', icon: '➕' },
  { id: 'wall', label: '画墙', icon: '🧱' },
  { id: 'grid', label: '网格', icon: '⊞' },
  { id: 'map', label: '地图', icon: '🗺' },
  { id: 'zoom', label: '缩放', icon: '🔍' },
] as const;

export default function Toolbar({ role = 'dm' }: { role?: 'dm' | 'player' }) {
  const visible = role === 'dm' ? TOOLS : TOOLS.filter(t => t.id === 'select' || t.id === 'zoom');
  return (
    <aside className="w-12 border-r border-zinc-700/60 bg-zinc-900 flex flex-col items-center py-2 gap-1">
      {visible.map(t => (
        <button key={t.id} title={t.label} className="w-9 h-9 rounded-md hover:bg-zinc-700 flex items-center justify-center text-lg">
          {t.icon}
        </button>
      ))}
    </aside>
  );
}
