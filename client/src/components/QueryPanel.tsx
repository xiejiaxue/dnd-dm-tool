import HoardRemixTab from './query/HoardRemixTab';
import HoardTab from './query/HoardTab';
import PhandelverTab from './query/PhandelverTab';
import StrahdRemixTab from './query/StrahdRemixTab';
import StrahdTab from './query/StrahdTab';
import WaterdeepTab from './query/WaterdeepTab';
import { useScene } from '../ws';
import DetailDrawer from './DetailDrawer';
import ChatPanel from './ChatPanel';
import JournalPanel from './JournalPanel';
import CampaignTab from './query/CampaignTab';
import CompendiumTab from './query/CompendiumTab';
import FavoritesTab from './query/FavoritesTab';
import NoteView from './query/NoteView';
import SearchControls from './query/SearchControls';
import type { useCompendiumSearch } from './query/useCompendiumSearch';
import { useFavoriteNames } from './query/useFavoriteNames';
import { useSceneDirectory } from './query/useSceneDirectory';
import type { JournalFocus, PanelDetail, QuestFocus } from './query/types';

export type QueryTab = 'chat' | 'query' | 'waterdeep' | 'strahd' | 'phandelver' | 'hoard' | 'hoardRemix' | 'strahdRemix' | 'camp' | 'journal' | 'fav';
type Tab = QueryTab;
const tabs: { id: Tab; label: string }[] = [{ id: 'chat', label: '聊天' }, { id: 'query', label: '查询' }, { id: 'waterdeep', label: '深水城' }, { id: 'strahd', label: '施特拉德' }, { id: 'phandelver', label: '凡戴尔' }, { id: 'hoard', label: '龙后' }, { id: 'hoardRemix', label: '龙后重置版' }, { id: 'strahdRemix', label: '施特拉德重置版' }, { id: 'camp', label: '战役库' }, { id: 'journal', label: '日志' }, { id: 'fav', label: '收藏' }];
const moduleTabs: Partial<Record<Tab, string>> = { waterdeep: 'waterdeep-dragon-heist', strahd: 'curse-of-strahd', phandelver: 'lost-mine-of-phandelver', hoard: 'hoard-of-the-dragon-queen', hoardRemix: 'hoard-of-the-dragon-queen-remix', strahdRemix: 'curse-of-strahd-remix' };
interface Props {
  collapsed: boolean; onToggleCollapsed: () => void; templateId?: string; tab: Tab; onTab: (tab: Tab) => void; unreadChat: number;
  /** Lifted to the table so the global search can open entries here. */
  detail: PanelDetail | null; onDetail: (detail: PanelDetail | null) => void;
  search: ReturnType<typeof useCompendiumSearch>;
  journalFocus?: JournalFocus; questFocus?: QuestFocus;
}

/** Module NPC libraries are DM reference (stats, factions, spoilers). A
 * campaign built from one module shows only that module; a blank or legacy
 * campaign keeps them all available to the DM. */
export function visibleTabs(role: string, templateId: string | undefined): Tab[] {
  const known = Object.values(moduleTabs).includes(templateId ?? '');
  return tabs.map(t => t.id).filter(id => {
    const module = moduleTabs[id];
    if (!module) return true;
    return role === 'dm' && (!known || module === templateId);
  });
}

export default function QueryPanel({ collapsed, onToggleCollapsed, templateId, tab, onTab, unreadChat, detail, onDetail: setDetail, search, journalFocus, questFocus }: Props) {
  const { scene, role, campaign } = useScene();
  const favNames = useFavoriteNames(scene?.favorites);
  const directory = useSceneDirectory(campaign?.sceneIds);
  const shown = visibleTabs(role, templateId);
  // A role change (e.g. while reconnecting) may remove the open tab.
  const current = shown.includes(tab) ? tab : 'query';
  if (collapsed) return null;

  return <aside id="campaign-query" className="campaign-query-panel" aria-label="战役资料" onKeyDown={e => { if (e.key === 'Escape') onToggleCollapsed(); }}>
    <div className="campaign-query-heading"><span className="panel-label">资料</span><button onClick={onToggleCollapsed} aria-label="收起资料面板" className="campaign-panel-close">×</button></div>
    <nav className="campaign-tabs" aria-label="资料分类">{tabs.filter(t => shown.includes(t.id)).map(t => <button key={t.id} aria-current={current === t.id ? 'page' : undefined} onClick={() => onTab(t.id)} className={current === t.id ? 'is-active' : ''}>{t.label}{t.id === 'chat' && unreadChat > 0 && <span className="campaign-unread" aria-label={`${unreadChat} 条未读`}>{unreadChat > 99 ? '99+' : unreadChat}</span>}</button>)}</nav>
    {current === 'chat' ? <ChatPanel /> : current === 'journal' ? <JournalPanel key={journalFocus?.nonce} focusId={journalFocus?.id} /> : detail ? detail.type === 'note' ? <NoteView note={detail} onBack={() => setDetail(null)} /> : <DetailDrawer entry={detail} onBack={() => setDetail(null)} /> : <>
      {current === 'query' && <><SearchControls {...search} /><CompendiumTab scene={scene} role={role} campaign={campaign} search={search} setDetail={setDetail} /></>}
      {current === 'strahd' && <StrahdTab scene={scene} role={role} campaign={campaign} setDetail={setDetail} />}
      {current === 'phandelver' && <PhandelverTab scene={scene} role={role} campaign={campaign} setDetail={setDetail} />}
      {current === 'hoard' && <HoardTab scene={scene} role={role} campaign={campaign} setDetail={setDetail} />}
      {current === 'hoardRemix' && <HoardRemixTab scene={scene} role={role} campaign={campaign} setDetail={setDetail} />}
      {current === 'strahdRemix' && <StrahdRemixTab scene={scene} role={role} campaign={campaign} setDetail={setDetail} />}
      {current === 'waterdeep' && <WaterdeepTab key={questFocus?.nonce} questFocus={questFocus} scene={scene} role={role} campaign={campaign} setDetail={setDetail} />}
      {current === 'fav' && <FavoritesTab favorites={scene?.favorites ?? []} favNames={favNames} role={role} setDetail={setDetail} />}
      {current === 'camp' && <CampaignTab scene={scene} role={role} campaign={campaign} directory={directory} />}
    </>}
  </aside>;
}
