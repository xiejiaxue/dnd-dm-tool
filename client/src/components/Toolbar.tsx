import { Fragment } from 'react';
import CampaignIcon from './CampaignIcon';

const TOOLS = [
  { id: 'select', label: '选择', icon: 'select', hint: '选择和移动棋子；拖动空白区域平移棋盘' },
  { id: 'add', label: '放置', icon: 'place', hint: '放置从资料库拿起的怪物' },
  { id: 'wall', label: '画墙', icon: 'wall', hint: '在棋盘上拖动绘制墙体' },
  { id: 'erase', label: '擦除', icon: 'erase', hint: '擦除墙体或揭开迷雾' },
] as const;

interface Props {
  role?: 'dm' | 'player' | 'spectator';
  tool: string;
  onTool: (t: string) => void;
  pendingLabel?: string | null;
  brushSize?: number;
  onBrushSize?: (n: number) => void;
}

export default function Toolbar({ role = 'dm', tool, onTool, pendingLabel, brushSize = 0, onBrushSize }: Props) {
  if (role !== 'dm') return null;
  const visible = TOOLS;
  return <aside className="campaign-toolbar" aria-label="棋盘工具">{visible.map(t => <Fragment key={t.id}>
    <button title={t.hint} aria-label={t.label} aria-pressed={tool === t.id} disabled={t.id === 'add' && !pendingLabel} onClick={() => onTool(t.id)} className={tool === t.id ? 'is-active' : ''}><CampaignIcon name={t.icon} /><span>{t.label}</span></button>
    {t.id === 'erase' && tool === 'erase' && onBrushSize && <div className="campaign-brush" aria-label="擦除范围">{[0, 1, 2].map(r => <button key={r} onClick={() => onBrushSize(r)} aria-pressed={brushSize === r} title={`${['小', '中', '大'][r]}号擦除范围`}>{['小', '中', '大'][r]}</button>)}</div>}
  </Fragment>)}{pendingLabel && <span className="campaign-pending">{pendingLabel}</span>}</aside>;
}
