import StrahdTab from './query/StrahdTab';
import WaterdeepTab from './query/WaterdeepTab';
import { useState } from 'react';
import { useScene } from '../ws';
import DetailDrawer from './DetailDrawer';
import ChatPanel from './ChatPanel';
import JournalPanel from './JournalPanel';
import CampaignTab from './query/CampaignTab';
import CompendiumTab from './query/CompendiumTab';
import FavoritesTab from './query/FavoritesTab';
import SearchControls from './query/SearchControls';
import { useCompendiumSearch } from './query/useCompendiumSearch';
import { useFavoriteNames } from './query/useFavoriteNames';
import { useSceneDirectory } from './query/useSceneDirectory';
import type { DetailEntry } from './query/types';

type Tab = 'chat' | 'query' | 'waterdeep' | 'strahd' | 'camp' | 'journal' | 'fav';
const tabs: { id: Tab; label: string }[] = [{ id: 'chat', label: '聊天' }, { id: 'query', label: '查询' }, { id: 'waterdeep', label: '深水城' }, { id: 'strahd', label: '施特拉德' }, { id: 'camp', label: '战役库' }, { id: 'journal', label: '日志' }, { id: 'fav', label: '收藏' }];
interface Props { collapsed: boolean; onToggleCollapsed: () => void }

export default function QueryPanel({ collapsed, onToggleCollapsed }: Props) {
  const [tab, setTab] = useState<Tab>('query');
  const [detail, setDetail] = useState<DetailEntry | null>(null);
  const { scene, role, campaign } = useScene();
  const search = useCompendiumSearch();
  const favNames = useFavoriteNames(scene?.favorites);
  const directory = useSceneDirectory(campaign?.sceneIds);
  if (collapsed) return null;

  return <aside id="campaign-query" className="campaign-query-panel" aria-label="战役资料" onKeyDown={e => { if (e.key === 'Escape') onToggleCollapsed(); }}>
    <div className="campaign-query-heading"><span className="panel-label">资料</span><button onClick={onToggleCollapsed} aria-label="收起资料面板" className="campaign-panel-close">×</button></div>
    <nav className="campaign-tabs" aria-label="资料分类">{tabs.filter(t => t.id !== 'strahd' || role === 'dm').map(t => <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => { setTab(t.id); setDetail(null); }} className={tab === t.id ? 'is-active' : ''}>{t.label}</button>)}</nav>
    {tab === 'chat' ? <ChatPanel /> : tab === 'journal' ? <JournalPanel /> : detail ? <DetailDrawer entry={detail} onBack={() => setDetail(null)} /> : <>
      {tab === 'query' && <><SearchControls {...search} /><CompendiumTab scene={scene} role={role} campaign={campaign} search={search} setDetail={setDetail} /></>}
      {tab === 'strahd' && role === 'dm' && <StrahdTab scene={scene} role={role} campaign={campaign} setDetail={setDetail} />}
      {tab === 'waterdeep' && <WaterdeepTab scene={scene} role={role} campaign={campaign} setDetail={setDetail} />}
      {tab === 'fav' && <FavoritesTab favorites={scene?.favorites ?? []} favNames={favNames} role={role} setDetail={setDetail} />}
      {tab === 'camp' && <CampaignTab scene={scene} role={role} campaign={campaign} directory={directory} />}
    </>}
  </aside>;
}
