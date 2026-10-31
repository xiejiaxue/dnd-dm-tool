import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ModuleNote } from '../../../../shared/encounter-presets';
import type { FactionQuestBook } from '../../../../shared/faction-quests';
import { api, type CampaignJournal } from '../../api';
import type { IndexEntry } from '../../types';
import type { RoomViewRole } from '../../ws';
import { loadBook } from '../query/FactionQuests';
import { entryHits, groupOrder, journalHits, noteHits, orderHits, queryWords, questHits, sceneHits, SEARCH_SHORTCUT, type SearchHit } from './global-search';

interface Props {
  role: RoomViewRole;
  /** Whether the Dragon Heist faction quests belong to this campaign. */
  withQuests: boolean;
  onClose: () => void;
  onOpen: (hit: SearchHit, query: string) => void;
  /** Hands the query to the 查询 tab, which also falls back to online data. */
  onSearchCompendium: (query: string) => void;
}

/** ⌘K palette over everything a table can look up: scenes, module notes, quests, journals and the rulebook. */
export default function GlobalSearch({ role, withQuests, onClose, onOpen, onSearchCompendium }: Props) {
  const isDm = role === 'dm';
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [journals, setJournals] = useState<CampaignJournal[]>([]);
  const [scenes, setScenes] = useState<{ id: string; name: string }[]>([]);
  const [book, setBook] = useState<FactionQuestBook | null>(null);
  const [remote, setRemote] = useState<{ query: string; entries: IndexEntry[]; notes: ModuleNote[] }>({ query: '', entries: [], notes: [] });
  const [failed, setFailed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Small lists are read once per opening and filtered locally on every keystroke.
  useEffect(() => {
    let live = true;
    api.journals().then(list => { if (live) setJournals(list); }, () => {});
    if (isDm) api.scenes().then(list => { if (live) setScenes(list); }, () => {});
    if (isDm && withQuests) loadBook().then(data => { if (live) setBook(data); }, () => {});
    return () => { live = false; };
  }, [isDm, withQuests]);

  // The rulebook and module notes are searched on the server, after a short pause in typing.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setRemote({ query: '', entries: [], notes: [] }); setFailed(false); return; }
    let live = true;
    const timer = setTimeout(() => {
      void Promise.allSettled([api.search(q, 'all'), isDm ? api.notes(q) : Promise.resolve([])]).then(([entries, notes]) => {
        if (!live) return;
        setFailed(entries.status === 'rejected' || notes.status === 'rejected');
        setRemote({ query: q, entries: entries.status === 'fulfilled' ? entries.value : [], notes: notes.status === 'fulfilled' ? notes.value : [] });
      });
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [query, isDm]);

  const words = useMemo(() => queryWords(query), [query]);
  const hits = useMemo(() => orderHits([
    ...sceneHits(scenes, words),
    ...noteHits(remote.notes, words),
    ...questHits(book, query),
    ...journalHits(journals, words),
    ...entryHits(remote.entries),
  ], words), [scenes, words, remote, book, query, journals]);
  const groups = useMemo(() => groupOrder(hits, words), [hits, words]);
  const pending = Boolean(query.trim()) && remote.query !== query.trim();
  const selected = Math.min(active, Math.max(0, hits.length - 1));

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive(Math.min(selected + 1, hits.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(selected - 1, 0)); }
    else if (event.key === 'Enter' && !event.nativeEvent.isComposing && hits[selected]) { event.preventDefault(); onOpen(hits[selected], query); }
  };

  let index = 0;
  return (
    <div className="campaign-search" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="campaign-search-dialog" role="dialog" aria-modal="true" aria-label="全局搜索" onKeyDown={onKeyDown}>
        <div className="campaign-search-field">
          <input autoFocus value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索" aria-controls="campaign-search-results"
            aria-activedescendant={hits[selected] ? `campaign-search-${selected}` : undefined}
            placeholder={isDm ? '搜索怪物、法术、场景、区域要点、任务、日志…' : '搜索怪物、法术、装备、规则、日志…'} />
          <kbd>Esc</kbd>
        </div>
        <div className="campaign-search-results" id="campaign-search-results" role="listbox" ref={listRef}>
          {!query.trim() && <p className="campaign-search-empty">{isDm ? '一次搜索规则书、本模组数据卡、场景、区域要点、派系任务和战役日志。' : '一次搜索规则书和 DM 公开的战役日志。'}<br />↑↓ 选择 · Enter 打开 · Esc 关闭 · 随时按 {SEARCH_SHORTCUT} 或 / 唤起</p>}
          {groups.map(group => {
            const rows = hits.filter(hit => hit.kind === group.kind);
            return <section key={group.kind} aria-label={group.label}>
              <h3 className="panel-label">{group.label}</h3>
              {rows.map(hit => {
                const at = index++;
                return <button key={hit.key} id={`campaign-search-${at}`} data-index={at} role="option" aria-selected={at === selected}
                  className={at === selected ? 'is-active' : ''} onMouseMove={() => { if (active !== at) setActive(at); }} onClick={() => onOpen(hit, query)}>
                  <span className="campaign-search-title">{hit.title}</span>
                  {hit.badge && <span className="campaign-search-badge">{hit.badge}</span>}
                  <span className="campaign-search-subtitle">{hit.subtitle}</span>
                </button>;
              })}
            </section>;
          })}
          {query.trim() && !pending && !hits.length && <p className="campaign-search-empty">没有找到「{query.trim()}」。</p>}
          {query.trim() && pending && !hits.length && <p className="campaign-search-empty">搜索中…</p>}
          {failed && <p className="campaign-search-empty">部分资料暂时无法读取，结果可能不全。</p>}
          {query.trim() && <button className="campaign-search-more" onClick={() => onSearchCompendium(query.trim())}>在「查询」中按类型筛选「{query.trim()}」，本地未命中时查在线资料 →</button>}
        </div>
      </div>
    </div>
  );
}
