import { Fragment } from 'react';
import Icon from './Icon';

const TOOLS = [
  { id: 'select', label: '选择', hint: '选择并拖动 Token、墙体或地图标记', icon: 'select' },
  { id: 'multi', label: '框选', hint: '框选多个地图对象；按住 Shift 追加选择', icon: 'grid' },
  { id: 'add', label: '放置 Token', hint: '将当前拿起的 Token 放到地图上', icon: 'plus' },
  { id: 'wall', label: '画墙', hint: '在地图上拖动绘制墙体', icon: 'wall' },
  { id: 'erase', label: '擦除迷雾', hint: '拖出矩形范围，任意擦除其中的战争迷雾', icon: 'erase' },
  { id: 'note', label: '放置地图标记', hint: '将当前选择的日志或文档标记放到地图上', icon: 'map' },
  { id: 'zoom', label: '缩放', hint: '使用指针调整地图视图的缩放与位置', icon: 'search' },
] as const;

interface Props {
  role?: 'dm' | 'player' | 'spectator';
  tool: string;
  onTool: (t: string) => void;
  pendingLabel?: string | null;
  canPlaceToken?: boolean;
  canPlaceNote?: boolean;
  diceOpen?: boolean;
  onToggleDice?: () => void;
}

export default function Toolbar({ role = 'dm', tool, onTool, pendingLabel, canPlaceToken = false, canPlaceNote = false, diceOpen = false, onToggleDice }: Props) {
  const visible = (role === 'dm' ? TOOLS : TOOLS.filter(t => t.id === 'select' || t.id === 'zoom'))
    .filter(t => t.id !== 'add' || canPlaceToken)
    .filter(t => t.id !== 'note' || canPlaceNote);
  return (
    <aside aria-label="地图工具" className="tool-rail w-12 border-r border-zinc-700/60 bg-zinc-900 flex flex-col items-center py-2 gap-1">
      {visible.map(t => (
        <Fragment key={t.id}>
          <button title={t.hint} aria-label={t.label} aria-pressed={tool === t.id}
            onClick={() => onTool(t.id)}
            className={`w-9 h-9 rounded-md flex items-center justify-center text-lg ${tool === t.id ? 'bg-amber-600/30 text-amber-400' : 'hover:bg-zinc-700 text-zinc-300'}`}>
            <Icon name={t.icon}/><span>{t.id === 'add' ? '放置' : t.id === 'erase' ? '擦除' : t.id === 'note' ? '标记' : t.label}</span>
          </button>
        </Fragment>
      ))}
      <div className="my-1 h-px w-7 bg-zinc-700/70" />
      <button
        type="button"
        title={diceOpen ? '关闭掷骰板' : '打开掷骰板'}
        aria-label={diceOpen ? '关闭掷骰板' : '打开掷骰板'}
        aria-pressed={diceOpen}
        onClick={onToggleDice}
        className={`h-9 w-9 rounded-md text-xs font-bold ${diceOpen ? 'bg-amber-600/30 text-amber-400' : 'text-zinc-300 hover:bg-zinc-700'}`}
      ><Icon name="dice"/><span>掷骰</span></button>
      {pendingLabel && <div className="mt-2 text-[10px] text-amber-400 text-center leading-tight px-1">{pendingLabel}</div>}
    </aside>
  );
}
