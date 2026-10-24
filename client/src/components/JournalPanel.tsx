import { useCallback, useEffect, useState } from 'react';
import { api, type CampaignJournal } from '../api';
import { useScene } from '../ws';

// Mirrors the Worker's JOURNAL_CONTENT_LIMIT.
const CONTENT_LIMIT = 50_000;
// Players see journals the DM publishes without reopening the tab.
const REFRESH_MS = 30_000;

export default function JournalPanel() {
  const { role, campaign } = useScene();
  const [journals, setJournals] = useState<CampaignJournal[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<'dm' | 'players'>('dm');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = journals.find(journal => journal.id === selectedId) ?? null;

  const reload = useCallback(() => api.journals().then(setJournals).catch(cause => setError(cause instanceof Error ? cause.message : '读取日志失败')), []);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, REFRESH_MS);
    const onFocus = () => { void reload(); };
    addEventListener('focus', onFocus);
    return () => { clearInterval(timer); removeEventListener('focus', onFocus); };
  }, [reload, campaign?.id]);

  const edit = (journal?: CampaignJournal) => {
    setEditing({ id: journal?.id ?? null });
    setTitle(journal?.title ?? '新日志');
    setContent(journal?.content ?? '');
    setVisibility(journal?.visibility ?? 'dm');
    setError('');
  };

  const run = async (action: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : fallback); }
    finally { setBusy(false); }
  };

  const save = () => run(async () => {
    const payload = { title: title.trim(), content, visibility };
    const next = editing?.id ? await api.updateJournal(editing.id, payload) : await api.createJournal(payload);
    await reload();
    setSelectedId(next.id);
    setEditing(null);
  }, '保存失败，内容仍保留在编辑器中');

  const remove = (journal: CampaignJournal) => {
    if (!window.confirm(`删除日志「${journal.title}」？`)) return;
    void run(async () => {
      await api.deleteJournal(journal.id);
      setSelectedId(null);
      await reload();
    }, '删除失败');
  };

  const errorLine = error && <p role="alert" className="px-3 py-2 text-xs text-accent">{error}</p>;

  if (editing) {
    const tooLong = content.trim().length > CONTENT_LIMIT;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} aria-label="日志标题" className="field-sm font-medium" />
        <textarea value={content} onChange={event => setContent(event.target.value)} placeholder="线索、剧情、NPC、玩家手册……" aria-label="日志内容"
          className="field-sm min-h-0 flex-1 resize-none p-2 text-sm leading-relaxed" />
        <div className={`text-right text-[10px] tabular-nums ${tooLong ? 'text-accent' : 'text-faint'}`}>{content.trim().length} / {CONTENT_LIMIT}</div>
        <div className="flex items-center gap-2">
          <select value={visibility} onChange={event => setVisibility(event.target.value as typeof visibility)} aria-label="可见范围" className="field-sm w-auto text-xs">
            <option value="dm">仅 DM</option><option value="players">玩家可见</option>
          </select>
          <button onClick={() => setEditing(null)} disabled={busy} className="btn-xs ml-auto">取消</button>
          <button onClick={() => { void save(); }} disabled={busy || !title.trim() || tooLong} className="btn-primary">{busy ? '保存中…' : '保存'}</button>
        </div>
        {errorLine}
      </div>
    );
  }

  if (selected) {
    return (
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setSelectedId(null)} aria-label="返回日志列表" className="text-muted hover:text-accent">←</button>
          <h3 className="min-w-0 flex-1 truncate font-semibold">{selected.title}</h3>
          <span className="shrink-0 text-[10px] text-muted">{selected.visibility === 'players' ? '玩家可见' : '仅 DM'}</span>
        </div>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{selected.content || '（空白）'}</p>
        {role === 'dm' && <div className="mt-4 flex gap-2">
          <button onClick={() => edit(selected)} className="btn-xs">编辑</button>
          <button onClick={() => remove(selected)} disabled={busy} className="btn-xs hover:border-accent hover:text-accent">删除</button>
        </div>}
        {errorLine}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {role === 'dm' && <button onClick={() => edit()} className="btn-primary m-2">＋ 新建战役日志</button>}
      {errorLine}
      <div className="flex-1 overflow-y-auto">
        {journals.map(journal => (
          <button key={journal.id} onClick={() => setSelectedId(journal.id)} className="w-full border-b border-line px-3 py-3 text-left hover:bg-well transition-colors duration-150">
            <span className="block truncate text-ink">{journal.title}</span>
            <span className="mt-1 block text-xs text-muted">{journal.visibility === 'players' ? '玩家可见' : '仅 DM'} · {new Date(journal.updatedAt).toLocaleString()}</span>
          </button>
        ))}
        {journals.length === 0 && <p className="p-4 text-center text-xs text-faint">{role === 'dm' ? '暂无战役日志' : 'DM 还没有公开日志'}</p>}
      </div>
    </div>
  );
}
