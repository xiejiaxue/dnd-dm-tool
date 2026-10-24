import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { connection } from '../../ws';
import type { Campaign } from '../../types';
import { FACTION_NOTE_LIMIT, QUEST_STATUSES, QUEST_STATUS_LABELS, type FactionChain, type FactionQuest, type FactionQuestBook, type QuestStatus } from '../../../../shared/faction-quests';
import MiniMarkdown, { inline } from './MiniMarkdown';

// One request per page load; the book only changes with a new release.
let bookRequest: Promise<FactionQuestBook> | null = null;
const loadBook = () => {
  bookRequest ??= api.waterdeepFactionQuests().catch(error => { bookRequest = null; throw error; });
  return bookRequest;
};

const STATUS_STYLE: Record<QuestStatus, string> = {
  open: 'border-ink text-ink',
  active: 'border-ink bg-ink text-white',
  done: 'border-[#38604b] bg-[#38604b] text-white',
  failed: 'border-accent bg-accent text-white',
};

export function questStatus(campaign: Campaign | null, questId: string): QuestStatus {
  return campaign?.questProgress?.[questId] ?? 'open';
}

/** done / total and in-progress count for one chain. */
export function chainProgress(campaign: Campaign | null, chain: FactionChain) {
  const statuses = chain.quests.map(quest => questStatus(campaign, quest.id));
  return { total: statuses.length, done: statuses.filter(status => status === 'done').length, active: statuses.filter(status => status === 'active').length };
}

/** Quests whose code, title or fields mention every word of the query. */
export function searchQuests(book: FactionQuestBook, query: string): { chain: FactionChain; quest: FactionQuest }[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return book.chains.flatMap(chain => chain.quests
    .filter(quest => {
      const haystack = [chain.name, quest.code, quest.title, ...quest.fields.map(field => field.text), quest.body ?? ''].join(' ').toLocaleLowerCase();
      return words.every(word => haystack.includes(word));
    })
    .map(quest => ({ chain, quest })));
}

interface Props {
  campaign: Campaign | null;
  npcCount: (npcFaction: string) => number;
  onShowNpcs: (npcFaction: string) => void;
}

export default function FactionQuests({ campaign, npcCount, onShowNpcs }: Props) {
  const [book, setBook] = useState<FactionQuestBook | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [focusQuest, setFocusQuest] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let active = true;
    loadBook().then(data => { if (active) setBook(data); }, cause => { if (active) setError(cause instanceof Error ? cause.message : '读取派系任务失败'); });
    return () => { active = false; };
  }, []);
  const results = useMemo(() => book ? searchQuests(book, query) : [], [book, query]);

  if (error) return <p role="alert" className="p-3 text-sm text-accent">{error}</p>;
  if (!book) return <p role="status" className="p-3 text-sm text-muted">正在读取派系任务…</p>;

  const open = (id: string, questId: string | null = null) => { setSelected(id); setFocusQuest(questId); };
  if (selected === 'overview') return <Overview book={book} onBack={() => setSelected(null)} />;
  const chain = book.chains.find(item => item.id === selected);
  if (chain) return <Chain chain={chain} campaign={campaign} focusQuest={focusQuest} npcCount={npcCount} onShowNpcs={onShowNpcs} onBack={() => setSelected(null)} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <input aria-label="搜索派系任务" placeholder="搜索任务、人物、地点或奖励" value={query} onChange={event => setQuery(event.target.value)} className="w-full rounded border border-line bg-well px-2 py-1.5 text-sm" />
        <p className="text-xs text-muted">主持人专用，含剧透。任务进度与备注随战役保存，玩家看不到。</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {query.trim() ? <>
          {results.map(({ chain: owner, quest }) => (
            <button key={quest.id} onClick={() => open(owner.id, quest.id)} className="w-full border-b border-line px-3 py-2 text-left hover:bg-well">
              <span className="flex items-center gap-2"><strong className="text-xs tabular-nums text-accent">{quest.code}</strong><span className="min-w-0 flex-1 truncate text-sm">{quest.title}</span><StatusTag status={questStatus(campaign, quest.id)} /></span>
              <span className="block text-xs text-muted">{owner.name}</span>
            </button>
          ))}
          {!results.length && <p className="p-3 text-sm text-muted">没有找到相关任务。</p>}
        </> : <>
          <button onClick={() => open('overview')} className="w-full border-b border-line bg-well px-3 py-2 text-left hover:bg-panel">
            <strong className="block text-sm">共用规则、冲突与节奏</strong>
            <span className="block text-xs text-muted">谁会主动接触、多派系冲突、日期排期、登记模板</span>
          </button>
          {book.chains.map(item => {
            const progress = chainProgress(campaign, item);
            const noted = Boolean(campaign?.factionNotes?.[item.id]);
            return (
              <button key={item.id} onClick={() => open(item.id)} className="w-full border-b border-line px-3 py-2 text-left hover:bg-well">
                <span className="flex items-center gap-2">
                  <strong className="min-w-0 flex-1 truncate text-sm">{item.name}</strong>
                  {item.kind === 'ally' && <span className="shrink-0 text-[10px] text-muted">独立合作者</span>}
                  {progress.total > 0 && <span className="shrink-0 text-[10px] tabular-nums text-muted">{progress.done}/{progress.total}{progress.active ? ` · 进行中 ${progress.active}` : ''}</span>}
                  {noted && <span className="shrink-0 text-[10px] text-accent" title="有主持人备注">备注</span>}
                </span>
                <span className="block truncate text-xs text-muted">{item.tagline}{item.contact ? ` · ${item.contact}` : ''}</span>
              </button>
            );
          })}
        </>}
      </div>
    </div>
  );
}

function StatusTag({ status }: { status: QuestStatus }) {
  if (status === 'open') return null;
  return <span className={`shrink-0 border px-1 text-[10px] ${STATUS_STYLE[status]}`}>{QUEST_STATUS_LABELS[status]}</span>;
}

function Header({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b-2 border-ink px-3 py-2">
      <button onClick={onBack} aria-label="返回派系列表" className="text-lg leading-none text-muted hover:text-accent">←</button>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-bold">{title}</h3>
        {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
      </div>
    </div>
  );
}

function Section({ heading, markdown, open }: { heading: string; markdown: string; open?: boolean }) {
  return (
    <details open={open} className="border-b border-line px-3 py-2">
      <summary className="cursor-pointer text-xs font-semibold">{heading}</summary>
      <div className="mt-2"><MiniMarkdown text={markdown} /></div>
    </details>
  );
}

function Overview({ book, onBack }: { book: FactionQuestBook; onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header title="共用规则、冲突与节奏" subtitle={book.title} onBack={onBack} />
      <div className="flex-1 overflow-y-auto">
        {book.overview.map((section, index) => <Section key={section.heading} heading={section.heading} markdown={section.markdown} open={index === 0} />)}
      </div>
    </div>
  );
}

interface ChainProps {
  chain: FactionChain;
  campaign: Campaign | null;
  focusQuest: string | null;
  npcCount: (npcFaction: string) => number;
  onShowNpcs: (npcFaction: string) => void;
  onBack: () => void;
}

function Chain({ chain, campaign, focusQuest, npcCount, onShowNpcs, onBack }: ChainProps) {
  const saved = campaign?.factionNotes?.[chain.id] ?? '';
  const [note, setNote] = useState(saved);
  // Follow edits from a co-DM unless this DM is typing.
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setNote(saved); }, [saved, editing]);
  const npcs = chain.npcFaction ? npcCount(chain.npcFaction) : 0;
  // Read the field itself: a blur can arrive before the last keystroke re-renders.
  const saveNote = (value: string) => {
    setEditing(false);
    setNote(value);
    if (value !== saved && value.length <= FACTION_NOTE_LIMIT) connection.sendOps([{ op: 'setFactionNote', factionId: chain.id, note: value }]);
  };
  // The contact section is what the DM needs first at the table.
  const firstOpen = chain.sections.findIndex(section => /牵线|速查|合作方式/.test(section.heading));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header title={chain.name} subtitle={chain.tagline} onBack={onBack} />
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-1.5 border-b border-line px-3 py-2 text-xs">
          {chain.contact && <p><span className="text-muted">联系人／方式：</span>{chain.contact}</p>}
          {chain.goal && <p><span className="text-muted">核心诉求：</span>{chain.goal}</p>}
          {npcs > 0 && <button onClick={() => onShowNpcs(chain.npcFaction!)} className="text-accent hover:underline">查看相关 NPC（{npcs}）→</button>}
          {chain.notes.length > 0 && <details><summary className="cursor-pointer text-muted">使用须知</summary><div className="mt-1 space-y-1 text-muted">{chain.notes.map((line, index) => <p key={index}>{inline(line)}</p>)}</div></details>}
        </div>
        <div className="border-b border-line px-3 py-2">
          <label className="block text-xs font-semibold" htmlFor={`faction-note-${chain.id}`}>主持人备注</label>
          <textarea id={`faction-note-${chain.id}`} value={note} rows={3} maxLength={FACTION_NOTE_LIMIT}
            onFocus={() => setEditing(true)} onChange={event => setNote(event.target.value)} onBlur={event => saveNote(event.currentTarget.value)}
            placeholder="关注的角色、已知情报、当前委托与期限、承诺奖励／已付、证据归属……"
            className="field-sm mt-1 w-full resize-y p-2 text-xs leading-relaxed" />
          <p className="text-right text-[10px] tabular-nums text-faint">{note.length} / {FACTION_NOTE_LIMIT} · 离开输入框时保存</p>
        </div>
        {chain.quests.length > 0 && <div className="border-b border-line">
          <div className="bg-well px-3 py-1.5 panel-label">任务（{chainProgress(campaign, chain).done}/{chain.quests.length} 完成）</div>
          {chain.quests.map(quest => <Quest key={quest.id} quest={quest} status={questStatus(campaign, quest.id)} open={quest.id === focusQuest} />)}
        </div>}
        {chain.sections.map((section, index) => <Section key={`${section.heading}-${index}`} heading={section.heading} markdown={section.markdown} open={index === firstOpen} />)}
      </div>
    </div>
  );
}

function Quest({ quest, status, open }: { quest: FactionQuest; status: QuestStatus; open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // A quest opened from search results is brought into view once.
  useEffect(() => { if (open) ref.current?.scrollIntoView({ block: 'start' }); }, [open]);
  return (
    <div ref={ref} className="border-t border-line px-3 py-2 first:border-t-0">
      <details open={open}>
        <summary className="cursor-pointer text-sm">
          <strong className="mr-1.5 text-xs tabular-nums text-accent">{quest.code}</strong>{quest.title}
          {quest.fields.find(field => /奖励|报酬/.test(field.label)) && <span className="ml-1.5 text-[10px] text-muted">{quest.fields.find(field => /奖励|报酬/.test(field.label))!.text.split(/[；;]/)[0]}</span>}
        </summary>
        <div className="mt-2 space-y-2">
          {quest.fields.map(field => <div key={field.label} className="text-xs"><span className="block text-[10px] font-semibold text-muted">{field.label}</span><MiniMarkdown text={field.text} /></div>)}
          {quest.body && <MiniMarkdown text={quest.body} />}
        </div>
      </details>
      <div className="mt-1.5 flex gap-1" role="group" aria-label={`${quest.code} 状态`}>
        {QUEST_STATUSES.map(option => (
          <button key={option} aria-pressed={status === option}
            onClick={() => { if (status !== option) connection.sendOps([{ op: 'setQuestStatus', questId: quest.id, status: option }]); }}
            className={`border px-1.5 py-0.5 text-[10px] ${status === option ? STATUS_STYLE[option] : 'border-line text-muted hover:border-ink hover:text-ink'}`}>
            {QUEST_STATUS_LABELS[option]}
          </button>
        ))}
      </div>
    </div>
  );
}
