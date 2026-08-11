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
        <input value={title} onChange={event => setTitle(event.target.value)} className="rounded bg-zinc-800 px-2 py-1 font-medium outline-none focus:ring-1 focus:ring-amber-500" />
        <textarea value={content} onChange={event => setContent(event.target.value)} placeholder="线索、剧情、NPC、玩家手册……"
          className="mt-2 min-h-0 flex-1 resize-none rounded bg-zinc-950 p-2 text-sm leading-relaxed outline-none focus:ring-1 focus:ring-amber-500" />
        <div className="mt-2 flex gap-2">
          <select value={visibility} onChange={event => setVisibility(event.target.value as typeof visibility)} className="rounded bg-zinc-800 px-2 text-xs">
            <option value="dm">仅 DM</option><option value="players">玩家可见</option>
          </select>
          <button onClick={() => setEditing(false)} className="ml-auto rounded bg-zinc-800 px-3 py-1">取消</button>
          <button onClick={() => { void save(); }} className="rounded bg-amber-500 px-3 py-1 text-zinc-950">保存</button>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex items-center gap-2"><button onClick={() => setSelected(null)}>←</button><h3 className="font-semibold">{selected.title}</h3></div>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{selected.content || '（空白）'}</p>
        {role === 'dm' && <button onClick={() => edit(selected)} className="mt-4 rounded bg-zinc-800 px-3 py-1 text-xs hover:bg-zinc-700">编辑</button>}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {role === 'dm' && <button onClick={() => edit()} className="m-2 rounded bg-amber-500/15 py-2 text-sm text-amber-300 hover:bg-amber-500/25">＋ 新建战役日志</button>}
      <div className="flex-1 overflow-y-auto">
        {journals.map(journal => (
          <button key={journal.id} onClick={() => setSelected(journal)} className="w-full border-b border-zinc-800 px-3 py-3 text-left hover:bg-zinc-800">
            <span className="block text-zinc-200">{journal.title}</span>
            <span className="mt-1 block text-xs text-zinc-500">{journal.visibility === 'players' ? '玩家可见' : '仅 DM'} · {new Date(journal.updatedAt).toLocaleString()}</span>
          </button>
        ))}
        {journals.length === 0 && <p className="p-4 text-center text-xs text-zinc-600">暂无战役日志</p>}
      </div>
    </div>
  );
}
