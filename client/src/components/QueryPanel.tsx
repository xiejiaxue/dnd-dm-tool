import { useEffect, useState } from 'react';
import { connection } from '../ws';
import { useScene } from '../ws';
import { setPending } from '../pending';
import DetailDrawer from './DetailDrawer';
import { type EntryType, type IndexEntry } from '../types';
import { useCompendiumSearch } from '../features/compendium/useCompendiumSearch';
import { useFavoriteNames } from '../features/compendium/useFavoriteNames';
import { createMonsterToken } from '../features/compendium/monsterToken';
import { useSceneCatalog } from '../features/campaign/useSceneCatalog';
import CampaignSceneLibrary from '../features/campaign/CampaignSceneLibrary';
import NpcPanel from '../features/npc/NpcPanel';
import ActorClaimPanel from '../features/actors/ActorClaimPanel';
import JournalPanel from '../features/journal/JournalPanel';
import MacroPanel from '../features/macros/MacroPanel';
import { subscribeJournalNavigation } from '../documents/navigation';
import { subscribeMacroLibraryNavigation } from '../features/macros/navigation';
import { useBoardCommands } from '../features/history/BoardCommandContext';
import TabletopToolsPanel from '../features/tools/TabletopToolsPanel';
import { subscribeActorNavigation } from '../features/actors/navigation';
import { subscribeToolNavigation } from '../features/tools/navigation';

type Tab = 'query' | 'camp' | 'npc' | 'actor' | 'journal' | 'macro' | 'tools' | 'fav';

interface Props {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectTool?: (tool: string) => void;
  onRequestFloat?: () => void;
}

export default function QueryPanel({ collapsed, onToggleCollapsed, onSelectTool, onRequestFloat }: Props) {
  const [tab, setTab] = useState<Tab>('query');
  const [q, setQ] = useState('');
  const [type, setType] = useState<EntryType | 'all'>('all');
  const { performOps } = useBoardCommands();
  const { results, source: resultSource } = useCompendiumSearch(q, type);
  // DetailDrawer only needs the id trio; both search results and favorites fit it.
  const [detail, setDetail] = useState<{ type: EntryType; id: string; nameZh: string } | null>(null);
  const { scene, role, campaign, viewer, activeSceneId } = useScene();
  const canReadAll = role === 'dm' || viewer?.canReadAll === true;
  // Favorites tab: resolve the Chinese name for each favorited entryId.
  const favorites = scene?.favorites ?? [];
  const favNames = useFavoriteNames(favorites);

  // Resolve the scene id -> {name, unlocked} mapping for the campaign tab's scene
  // list. Players only see DM-unlocked scenes (read-only preview); DMs switch.
  const sceneNames = useSceneCatalog(campaign?.sceneIds ?? []);
  // Read-only scene preview for players (map thumbnail + token list).

  useEffect(() => subscribeJournalNavigation(() => {
    setTab('journal');
    setDetail(null);
  }), []);

  useEffect(() => subscribeMacroLibraryNavigation(() => {
    setTab('macro');
    setDetail(null);
  }), []);
  useEffect(() => subscribeActorNavigation(() => { setTab('actor'); setDetail(null); }), []);
  useEffect(() => subscribeToolNavigation(() => { setTab('tools'); setDetail(null); }), []);

  // Directly add a monster token to a predictable visible spawn zone. Counting
  // every token prevents different monster types from stacking on each other.
  const spawnEnemy = (entryId: string, nameZh: string, maximumHitPoints?: number) => {
    if (!scene) return;
    performOps(`添加 ${nameZh} Token`, [{
      op: 'addToken',
      token: createMonsterToken(
        scene,
        { id: entryId, nameZh, hitPoints: maximumHitPoints },
        `token-${crypto.randomUUID()}`,
      ),
    }]);
  };
  const addMonsterToScene = (r: IndexEntry) => spawnEnemy(r.id, r.nameZh, r.hitPoints);
  const isInLibrary = (entryId: string) => (campaign?.enemies ?? []).some(e => e.entryId === entryId);

  const hasPublicNpcs = (campaign?.npcs?.length ?? 0) > 0;
  const tabs: Tab[] = canReadAll || hasPublicNpcs
    ? ['query', 'camp', 'actor', 'npc', 'journal', 'macro', 'tools', 'fav']
    : ['query', 'camp', 'actor', 'journal', 'macro', 'tools', 'fav'];

  // Collapsed: a thin vertical bar so players can reclaim board space.
  if (collapsed) {
    return (
      <aside className="h-full w-10 border-l border-zinc-700/60 bg-zinc-900 flex flex-col items-center pt-2 text-sm">
        <button
          onClick={onToggleCollapsed}
          title="展开查询面板"
          aria-label="展开右侧资料面板"
          className="w-8 h-8 rounded-md hover:bg-zinc-700 text-zinc-400 text-lg"
        >⇥</button>
      </aside>
    );
  }

  return (
    <aside className="relative flex h-full w-full flex-col border-l border-zinc-700/60 bg-zinc-900 text-sm">
      <div className="library-tabs flex items-center border-b border-zinc-800">
        {tabs.map(t => (
          <button key={t} onClick={() => { setTab(t); setDetail(null); }}
            className={`shrink-0 px-2.5 py-2 text-center text-xs ${tab === t ? 'text-amber-400 border-b-2 border-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {tabLabel(t)}
          </button>
        ))}
        <button
          onClick={onToggleCollapsed}
          title="收起查询面板"
          aria-label="收起右侧资料面板"
          className="shrink-0 px-2 h-8 text-zinc-500 hover:text-zinc-200 text-lg"
        >⇤</button>
        {onRequestFloat && <button type="button" onClick={onRequestFloat} title="浮动资料面板" aria-label="浮动资料面板"
          className="shrink-0 px-2 text-xs text-zinc-500 hover:text-zinc-200">浮</button>}
      </div>

      {detail ? (
        <DetailDrawer entry={detail} onBack={() => setDetail(null)} />
      ) : (
        <>
          {tab === 'query' && <div className="p-2 flex gap-1">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索怪物 / 法术 / 装备…"
              className="flex-1 bg-zinc-800 rounded px-2 py-1 outline-none focus:ring-1 ring-amber-500" />
            <select value={type} onChange={e => setType(e.target.value as EntryType | 'all')} className="bg-zinc-800 rounded px-1">
              <option value="all">全部</option>
              <option value="monster">怪物</option>
              <option value="spell">法术</option>
              <option value="item">装备</option>
              <option value="feat">专长</option>
            </select>
          </div>}
          {tab === 'query' && (
            <div className="px-3 pb-2 text-[10px] text-zinc-600">
              资料：
              <a href="https://github.com/tjliqy/5etools-cn" target="_blank" rel="noreferrer" className="hover:text-zinc-400 underline">DND5E 不全书</a>
              {' + '}
              <a href="https://github.com/5etools-mirror-3/5etools-src" target="_blank" rel="noreferrer" className="hover:text-zinc-400 underline">5etools</a>
              {' · 中文数据 '}
              <a href="https://github.com/tjliqy/5etools-cn/blob/cn2.0/LICENSE.md" target="_blank" rel="noreferrer" className="hover:text-zinc-400 underline">CC BY-NC-SA 4.0</a>
            </div>
          )}
          {tab === 'query' && (
            <div className="flex-1 overflow-y-auto">
              {q.trim() && resultSource === 'online' && (
                <div className="px-3 py-2 text-xs text-sky-300 bg-sky-950/30 border-b border-sky-900/60">
                  本地资料未命中，显示在线 <a href="https://github.com/tjliqy/5etools-cn" target="_blank" rel="noreferrer" className="underline hover:text-sky-200">5e 不全书（tjliqy/5etools-cn）</a>结果（<a href="https://github.com/tjliqy/5etools-cn/blob/cn2.0/LICENSE.md" target="_blank" rel="noreferrer" className="underline hover:text-sky-200">CC BY-NC-SA 4.0</a>）。
                </div>
              )}
              {q.trim() && resultSource === 'unavailable' && (
                <div className="px-3 py-2 text-xs text-amber-300 bg-amber-950/30 border-b border-amber-900/60">
                  本地未找到结果，在线资料暂时不可用。
                </div>
              )}
              {results.map(r => (
                <div key={r.id} className="flex items-center border-b border-zinc-800/50 hover:bg-zinc-800">
                  <button onClick={() => setDetail(r)} className="flex-1 text-left px-3 py-2 min-w-0">
                    <span className="block text-zinc-100 truncate">{r.nameZh}</span>
                    <span className="block text-xs text-zinc-500 truncate">{r.nameEn} · {r.source}</span>
                  </button>
                  <span className="shrink-0 text-xs text-amber-400/80 pr-1">
                    {r.type === 'monster' ? r.cr ?? '' : r.type === 'spell' ? `${r.level ?? 0} 环` : ''}
                  </span>
                  {role === 'dm' && r.type === 'monster' && (
                    <button
                      onClick={() => addMonsterToScene(r)}
                      title="添加到场景"
                      className="shrink-0 mr-2 ml-1 px-2 py-1 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 text-xs"
                    >＋ 添加</button>
                  )}
                  {role === 'dm' && r.type === 'monster' && (
                    <button
                      onClick={() => connection.sendOps([{ op: 'addEnemy', entryId: r.id, nameZh: r.nameZh }])}
                      title="加入战役库"
                      className={`shrink-0 mr-1 px-1.5 py-0.5 rounded text-xs ${isInLibrary(r.id) ? 'text-zinc-600' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
                      disabled={isInLibrary(r.id)}
                    >{isInLibrary(r.id) ? '已在库' : '入库'}</button>
                  )}
                </div>
              ))}
              {q.trim() && results.length === 0 && resultSource !== 'unavailable' && (
                <div className="p-3 text-zinc-500 text-xs">
                  <span>无结果</span>
                  {role === 'dm' && <button onClick={() => setTab('npc')} className="ml-2 text-sky-400 hover:text-sky-300">归档为 NPC →</button>}
                </div>
              )}
            </div>
          )}
          {tab === 'fav' && (
            <div className="flex-1 overflow-y-auto">
              {favorites.length === 0 && <div className="p-3 text-zinc-500 text-xs">收藏夹为空，从查询中点击 ★ 收藏</div>}
              {favorites.map(f => {
                const zh = favNames[f.entryId] ?? f.entryId;
                return (
                  <div key={`${f.type}-${f.entryId}`}
                    className="flex w-full items-center border-b border-zinc-800/50 hover:bg-zinc-800">
                    <button type="button" onClick={() => setDetail({ type: f.type, id: f.entryId, nameZh: zh })}
                      className="min-w-0 flex-1 px-3 py-2 text-left">
                      <span>
                      <span className="block text-zinc-100">{zh}</span>
                      <span className="block text-xs text-zinc-500">{f.entryId}</span>
                      </span>
                    </button>
                    {role !== 'spectator' && (
                      <button type="button" className="mr-3 shrink-0 rounded px-1 text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
                        aria-label={`取消收藏 ${zh}`}
                        title={`取消收藏 ${zh}`}
                        onClick={() => connection.sendOps([{ op: 'removeFavorite', type: f.type, entryId: f.entryId }])}>✕</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {tab === 'npc' && (canReadAll || hasPublicNpcs) && <NpcPanel readOnly={role !== 'dm'} />}
          {tab === 'actor' && <ActorClaimPanel />}
          {tab === 'journal' && <JournalPanel />}
          {tab === 'macro' && <MacroPanel onSelectTool={onSelectTool} />}
          {tab === 'tools' && <TabletopToolsPanel />}
          {tab === 'camp' && (
            <div className="flex-1 overflow-y-auto">
              {canReadAll && (
                <>
                  <div className="px-3 py-1.5 text-xs text-zinc-500 bg-zinc-800/40">敌人 ({campaign?.enemies.length ?? 0})</div>
                  {(campaign?.enemies ?? []).map(e => (
                    <div key={e.entryId} className="flex items-center gap-2 px-2 py-1.5 border-b border-zinc-800/50 hover:bg-zinc-800/50">
                      <img src={`/api/token/${e.entryId}`} alt="" className="w-6 h-6 rounded-full bg-zinc-700 shrink-0" />
                      <span className="flex-1 truncate text-zinc-200">{e.nameZh}</span>
                      {role === 'dm' && <button onClick={() => spawnEnemy(e.entryId, e.nameZh)} title="一键放入当前场景"
                        className="shrink-0 px-1.5 py-0.5 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 text-xs">＋</button>
                      }
                      {role === 'dm' && <button onClick={() => setPending({ kind: 'monster', name: e.nameZh, entryId: e.entryId, avatar: `/api/token/${e.entryId}`, color: '#fff' })}
                        title="拿起放置" className="shrink-0 px-1.5 py-0.5 rounded hover:bg-zinc-700 text-zinc-300 text-xs">✋</button>
                      }
                      {role === 'dm' && <button onClick={() => connection.sendOps([{ op: 'removeEnemy', entryId: e.entryId }])}
                        title="移出战役库" className="shrink-0 px-1.5 py-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-red-400 text-xs">✕</button>
                      }
                    </div>
                  ))}
                  {(campaign?.enemies.length ?? 0) === 0 && <div className="p-3 text-zinc-500 text-xs">战役库为空，搜索怪物后点「加入战役库」</div>}
                </>
              )}
              <CampaignSceneLibrary
                role={role}
                canManage={viewer?.canManage === true}
                canReadAll={canReadAll}
                campaign={campaign}
                catalog={sceneNames}
                viewedSceneId={scene?.id}
                activeSceneId={activeSceneId}
              />
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function tabLabel(tab: Tab): string {
  if (tab === 'query') return '查询';
  if (tab === 'camp') return '场景';
  if (tab === 'actor') return '角色';
  if (tab === 'npc') return 'NPC';
  if (tab === 'journal') return '日志';
  if (tab === 'macro') return '宏';
  if (tab === 'tools') return '工具';
  return '收藏';
}
