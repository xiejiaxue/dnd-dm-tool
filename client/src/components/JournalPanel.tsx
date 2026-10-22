import { useEffect, useState } from 'react';
import { api, type CampaignJournal } from '../api';
import { useScene } from '../ws';

export default function JournalPanel() {
  const { role, campaign } = useScene();
  const [journals, setJournals] = useState<CampaignJournal[]>([]);
  const [selected, setSelected] = useState<CampaignJournal | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<'dm' | 'players'>('dm');

  const reload = () => api.journals().then(setJournals);
  useEffect(() => { void reload(); }, [campaign?.id]);

  const edit = (journal?: CampaignJournal) => {
    setSelected(journal ?? null);
    setTitle(journal?.title ?? '新日志');
    setContent(journal?.content ?? '');
    setVisibility(journal?.visibility ?? 'dm');
    setEditing(true);
  };

  const save = async () => {
    if (!title.trim()) return;
    const payload = { title: title.trim(), content, visibility };
    const next = selected ? await api.updateJournal(selected.id, payload) : await api.createJournal(payload);
    await reload();
    setSelected(next);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex min-h-0 flex-1 flex-col p-2">
        <input value={title} onChange={event => setTitle(event.target.value)} className="field font-medium" />
        <textarea value={content} onChange={event => setContent(event.target.value)} placeholder="线索、剧情、NPC、玩家手册……"
          className="field mt-2 min-h-0 flex-1 resize-none leading-relaxed" />
        <div className="mt-2 flex gap-2">
          <select value={visibility} onChange={event => setVisibility(event.target.value as typeof visibility)} className="field-sm w-auto">
            <option value="dm">仅 DM</option><option value="players">玩家可见</option>
          </select>
          <button onClick={() => setEditing(false)} className="btn-quiet ml-auto">取消</button>
          <button onClick={() => { void save(); }} className="btn-primary">保存</button>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex items-center gap-2 pb-2 border-b-2 border-ink">
          <button onClick={() => setSelected(null)} className="text-muted hover:text-accent text-lg leading-none transition-colors duration-150">←</button>
          <h3 className="font-bold">{selected.title}</h3>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{selected.content || '（空白）'}</p>
        {role === 'dm' && <button onClick={() => edit(selected)} className="btn-quiet mt-4">编辑</button>}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {role === 'dm' && <button onClick={() => edit()} className="btn-accent m-2">＋ 新建战役日志</button>}
      <div className="flex-1 overflow-y-auto">
        {journals.map(journal => (
          <button key={journal.id} onClick={() => setSelected(journal)} className="w-full border-b border-line px-3 py-3 text-left hover:bg-well transition-colors duration-150">
            <span className="block text-ink">{journal.title}</span>
            <span className="mt-1 block text-xs text-muted">{journal.visibility === 'players' ? '玩家可见' : '仅 DM'} · {new Date(journal.updatedAt).toLocaleString()}</span>
          </button>
        ))}
        {journals.length === 0 && <p className="p-4 text-center text-xs text-faint">暂无战役日志</p>}
      </div>
    </div>
  );
}
