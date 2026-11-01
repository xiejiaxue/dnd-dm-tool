import { useEffect, useState } from 'react';
import { api, type CampaignJournal } from '../api';
import { connection } from '../ws';
import type { MapNote, MapNotePatch } from '../types';
import { MAP_NOTE_TEXT_LIMIT } from '../../../shared/table-state';
import MiniMarkdown from './query/MiniMarkdown';
import ConfirmButton from './ConfirmButton';

interface Props {
  note: MapNote;
  canEdit: boolean;
  /** Opens straight into the editor, as after placing a new pin. */
  editing?: boolean;
  onClose: () => void;
  onOpenJournal?: (journalId: string) => void;
}

/** A map pin's card: read by everyone who can see the pin, edited by the DM. */
export default function MapNoteCard({ note, canEdit, editing: startEditing = false, onClose, onOpenJournal }: Props) {
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [title, setTitle] = useState(note.title);
  const [text, setText] = useState(note.text);
  const [visible, setVisible] = useState(note.visible);
  const [journalId, setJournalId] = useState(note.journal?.id ?? '');
  const [journals, setJournals] = useState<CampaignJournal[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editing) return;
    setTitle(note.title); setText(note.text); setVisible(note.visible); setJournalId(note.journal?.id ?? '');
    void api.journals().then(setJournals).catch(() => setError('读取日志列表失败，仍可保存其他内容'));
    // Load the form once per editing session; later remote edits must not overwrite typing.
  }, [editing]);

  const save = () => {
    const patch: MapNotePatch = {};
    if (title.trim() !== note.title) patch.title = title.trim();
    if (text !== note.text) patch.text = text;
    if (visible !== note.visible) patch.visible = visible;
    if (journalId !== (note.journal?.id ?? '')) {
      const journal = journals?.find(candidate => candidate.id === journalId);
      patch.journal = journal ? { id: journal.id, title: journal.title } : null;
    }
    if (Object.keys(patch).length) connection.sendOps([{ op: 'updateMapNote', noteId: note.id, patch }]);
    setEditing(false);
  };

  if (editing) {
    const tooLong = text.length > MAP_NOTE_TEXT_LIMIT;
    return <section className="map-note-card" aria-label="编辑地图笔记">
      <header><strong>地图笔记</strong><button type="button" aria-label="关闭" onClick={onClose}>✕</button></header>
      <input className="field-sm" aria-label="笔记标题" maxLength={120} value={title} onChange={event => setTitle(event.target.value)} autoFocus />
      <textarea className="field-sm" aria-label="笔记内容" placeholder="房间描述、陷阱、线索……支持 **加粗**、列表与表格" value={text} onChange={event => setText(event.target.value)} rows={7} />
      <div className={`map-note-count ${tooLong ? 'text-accent' : ''}`}>{text.length} / {MAP_NOTE_TEXT_LIMIT}</div>
      <label className="map-note-field">关联日志
        <select className="field-sm" value={journalId} onChange={event => setJournalId(event.target.value)} disabled={!journals}>
          <option value="">不关联</option>
          {note.journal && !journals?.some(journal => journal.id === note.journal!.id) && <option value={note.journal.id}>{note.journal.title}</option>}
          {journals?.map(journal => <option key={journal.id} value={journal.id}>{journal.title}{journal.visibility === 'dm' ? '（仅 DM）' : ''}</option>)}
        </select>
      </label>
      <label className="map-note-check"><input type="checkbox" checked={visible} onChange={event => setVisible(event.target.checked)} />玩家可见</label>
      {error && <p role="alert" className="text-accent">{error}</p>}
      <footer>
        <ConfirmButton className="btn-xs" armedClassName="text-accent" confirmLabel="确认删除" title="删除这枚图钉" onConfirm={() => { connection.sendOps([{ op: 'removeMapNote', noteId: note.id }]); onClose(); }}>删除</ConfirmButton>
        <button type="button" className="btn-xs ml-auto" onClick={() => setEditing(false)}>取消</button>
        <button type="button" className="btn-primary" disabled={!title.trim() || tooLong} onClick={save}>保存</button>
      </footer>
    </section>;
  }

  return <section className="map-note-card" aria-label={`地图笔记：${note.title}`}>
    <header><strong>{note.title}</strong>{canEdit && <span className="map-note-visibility">{note.visible ? '玩家可见' : '仅 DM'}</span>}<button type="button" aria-label="关闭" onClick={onClose}>✕</button></header>
    <div className="map-note-text">{note.text.trim() ? <MiniMarkdown text={note.text} /> : <p className="text-faint">（没有内容）</p>}</div>
    {(note.journal || canEdit) && <footer>
      {note.journal && onOpenJournal && <button type="button" className="btn-xs" onClick={() => onOpenJournal(note.journal!.id)}>打开日志：{note.journal.title}</button>}
      {canEdit && <>
        <button type="button" className="btn-xs ml-auto" onClick={() => connection.sendOps([{ op: 'updateMapNote', noteId: note.id, patch: { visible: !note.visible } }])}>{note.visible ? '对玩家隐藏' : '给玩家看'}</button>
        <button type="button" className="btn-xs" onClick={() => setEditing(true)}>编辑</button>
      </>}
    </footer>}
  </section>;
}
