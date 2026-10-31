import MusicNavigation from './MusicNavigation';
import Icon from './Icon';
import { extensionHref, extensionsFor } from '../shell/extensions';
import CampaignIcon from './CampaignIcon';
import { isToolActive, toolsFor, type Role } from './board-tools';

interface Props {
  role?: Role;
  tool: string;
  onTool: (t: string) => void;
  pendingLabel?: string | null;
  /** DM only: show the board as players see it. */
  playerPreview?: boolean;
  onPlayerPreview?: (on: boolean) => void;
  /** Module the campaign was created from; decides which module extensions appear. */
  templateId?: string;
  campaignSlug?: string;
}

/**
 * The board's tool rail. Tool options (fog mode, brush size, wall deletion…) live in a bar on the
 * board itself, next to where they act, so the rail only switches tools.
 */
export default function Toolbar({ role = 'dm', tool, onTool, pendingLabel, playerPreview = false, onPlayerPreview, templateId, campaignSlug }: Props) {
  return <aside className="campaign-toolbar" aria-label="棋盘工具">
    {toolsFor(role).map(t => {
      const active = isToolActive(t, tool);
      return <button key={t.id} title={t.key ? `${t.hint}（${t.key}）` : t.hint} aria-label={t.label} aria-keyshortcuts={t.key} aria-pressed={active} disabled={t.id === 'add' && !pendingLabel}
        onClick={() => onTool(t.id === 'erase' && tool === 'erase-area' ? 'erase-area' : t.id)} className={active ? 'is-active' : ''}>
        <CampaignIcon name={t.icon} /><span>{t.label}</span>{t.key && <kbd className="campaign-tool-key">{t.key}</kbd>}
      </button>;
    })}
    {role === 'dm' && onPlayerPreview && <button className={`campaign-tool-toggle ${playerPreview ? 'is-active' : ''}`} aria-pressed={playerPreview} aria-label="玩家视角" title="按玩家看到的样子显示棋盘：迷雾全黑，隐藏的敌人不显示" onClick={() => onPlayerPreview(!playerPreview)}>
      <CampaignIcon name="eye" /><span>玩家视角</span>
    </button>}
    <MusicNavigation campaign />
    {extensionsFor(templateId).map(extension => <a key={extension.page} href={extensionHref(extension, campaignSlug)} target="_blank" rel="noreferrer" title={`在新标签页打开${extension.label}，桌面保持连接`} className="campaign-music-link"><Icon name={extension.icon} /><span>{extension.label}</span></a>)}
    {pendingLabel && <span className="campaign-pending">{pendingLabel}</span>}
  </aside>;
}
