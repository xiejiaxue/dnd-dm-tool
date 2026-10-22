import { useEffect, useState } from 'react';
import ActionLogPanel from '../action-log/ActionLogPanel';
import SettingsPanel from '../settings/SettingsPanel';
import AssetLibraryPanel from './AssetLibraryPanel';
import EncounterPresetPanel from './EncounterPresetPanel';
import ItemLibraryPanel from './ItemLibraryPanel';
import PlaylistPanel from './PlaylistPanel';
import RollTablePanel from './RollTablePanel';
import { subscribeToolNavigation } from './navigation';
import ScenePrepPanel from './ScenePrepPanel';
import ContentTransferPanel from './ContentTransferPanel';

type Tab = 'item' | 'table' | 'preset' | 'scene' | 'asset' | 'audio' | 'log' | 'transfer' | 'settings';

export default function TabletopToolsPanel() {
  const [tab, setTab] = useState<Tab>('item');
  useEffect(() => subscribeToolNavigation(target => setTab(target.type === 'item' ? 'item' : target.type === 'roll_table' ? 'table' : target.type === 'playlist' ? 'audio' : 'preset')), []);
  return <div className="flex h-full flex-col overflow-hidden"><nav className="flex shrink-0 overflow-x-auto border-b border-zinc-800 bg-zinc-950/30">{(['item', 'table', 'preset', 'scene', 'asset', 'audio', 'log', 'transfer', 'settings'] as Tab[]).map(value => <button key={value} onClick={() => setTab(value)} className={`shrink-0 border-b-2 px-2 py-1.5 text-[10px] ${tab === value ? 'border-amber-400 text-amber-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>{label(value)}</button>)}</nav><div className="min-h-0 flex-1">{tab === 'item' ? <ItemLibraryPanel /> : tab === 'table' ? <RollTablePanel /> : tab === 'preset' ? <EncounterPresetPanel /> : tab === 'scene' ? <ScenePrepPanel /> : tab === 'asset' ? <AssetLibraryPanel /> : tab === 'audio' ? <PlaylistPanel /> : tab === 'log' ? <ActionLogPanel /> : tab === 'transfer' ? <ContentTransferPanel /> : <SettingsPanel />}</div></div>;
}

function label(tab: Tab): string { return ({ item: '物品', table: '随机表', preset: '遭遇预设', scene: '场景检查', asset: '素材', audio: '音效', log: '记录', transfer: '导入导出', settings: '设置' } as Record<Tab, string>)[tab]; }
