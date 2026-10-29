import MusicNavigation from './MusicNavigation';
import Icon from './Icon';
import { extensionHref, extensionsFor } from '../shell/extensions';
import { Fragment } from 'react';
import CampaignIcon from './CampaignIcon';

const TOOLS = [
  { id: 'select', label: '选择', icon: 'select', hint: '选择和移动棋子；拖动空白区域平移棋盘' },
  { id: 'select-tokens', label: '框选', icon: 'view', hint: '拖动框选敌人，批量显示或隐藏；Esc 取消选择' },
  { id: 'add', label: '放置', icon: 'place', hint: '放置从资料库拿起的怪物' },
  { id: 'wall', label: '画墙', icon: 'wall', hint: '在棋盘上拖动绘制墙体' },
  { id: 'erase', label: '擦除', icon: 'erase', hint: '拖动揭开迷雾' },
] as const;

interface Props {
  role?: 'dm' | 'player' | 'spectator';
  tool: string;
  onTool: (t: string) => void;
  pendingLabel?: string | null;
  brushSize?: number;
  onBrushSize?: (n: number) => void;
  /** Module the campaign was created from; decides which module extensions appear. */
  templateId?: string;
  campaignSlug?: string;
}

export default function Toolbar({ role = 'dm', tool, onTool, pendingLabel, brushSize = 0, onBrushSize, templateId, campaignSlug }: Props) {
  if (role !== 'dm') return null;
  const visible = TOOLS;
  return <aside className="campaign-toolbar" aria-label="棋盘工具">{visible.map(t => <Fragment key={t.id}>
    <button title={t.hint} aria-label={t.label} aria-pressed={(tool === t.id || (t.id === 'erase' && tool === 'erase-area'))} disabled={t.id === 'add' && !pendingLabel} onClick={() => onTool(t.id)} className={(tool === t.id || (t.id === 'erase' && tool === 'erase-area')) ? 'is-active' : ''}><CampaignIcon name={t.icon} /><span>{t.label}</span></button>
    {t.id === 'erase' && (tool === 'erase' || tool === 'erase-area') && <div className="campaign-brush" role="group" aria-label="擦除方式">
      <button onClick={() => onTool('erase')} aria-pressed={tool === 'erase'}>笔刷</button>
      <button onClick={() => onTool('erase-area')} aria-pressed={tool === 'erase-area'} title="拖动框选区域，松开揭开迷雾；Esc 取消">框选</button>
    </div>}
    {t.id === 'erase' && tool === 'erase' && onBrushSize && <div className="campaign-brush" aria-label="擦除范围">{[0, 1, 2].map(r => <button key={r} onClick={() => onBrushSize(r)} aria-pressed={brushSize === r} title={`${['小', '中', '大'][r]}号擦除范围`}>{['小', '中', '大'][r]}</button>)}</div>}
  </Fragment>)}<MusicNavigation campaign />{extensionsFor(templateId).map(extension => <a key={extension.page} href={extensionHref(extension, campaignSlug)} target="_blank" rel="noreferrer" title={`在新标签页打开${extension.label}，桌面保持连接`} className="campaign-music-link"><Icon name={extension.icon} /><span>{extension.label}</span></a>)}{pendingLabel && <span className="campaign-pending">{pendingLabel}</span>}</aside>;
}
