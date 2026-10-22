import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type RoomMemberSummary } from '../../api';
import { subscribeJournalNavigation } from '../../documents/navigation';
import {
  canReadDocument,
  canUpdateDocument,
  type DocumentOwnership,
  type JournalEntryDocument,
  type JournalPage,
  type ActorDocument,
  type ItemDocument,
  type DocumentFolder,
} from '../../types';
import { useScene } from '../../ws';
import { setPendingMapNote } from './mapNotePlacement';
import OwnershipEditor from '../../documents/OwnershipEditor';
import DocumentText from '../../documents/DocumentText';
import { connection } from '../../ws';
import { useActionLog } from '../action-log/ActionLogContext';
import { useTabletopSettings } from '../settings/TabletopSettingsContext';

export default function JournalPanel() {
  const { roomRole, viewer } = useScene();
  const [journals, setJournals] = useState<JournalEntryDocument[]>([]);
  const [selectedJournalId, setSelectedJournalId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [newJournalName, setNewJournalName] = useState('');
  const [newPageName, setNewPageName] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<RoomMemberSummary[]>([]);
  const [actors, setActors] = useState<ActorDocument[]>([]);
  const [items, setItems] = useState<ItemDocument[]>([]);
  const [query, setQuery] = useState('');
  const [previewAsPlayer, setPreviewAsPlayer] = useState(false);
  const [linkKind, setLinkKind] = useState<'actor' | 'item' | 'journal'>('actor');
  const [linkId, setLinkId] = useState('');
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const { record } = useActionLog();
  const { confirmAction } = useTabletopSettings();
  const canManage = roomRole === 'host' || roomRole === 'dm' || roomRole === 'assistant_dm';

  const load = useCallback(async () => {
    try {
      const [next, nextActors, nextItems, nextFolders] = await Promise.all([
        api.journals(), api.actors().then(value => value.actors).catch(() => []), api.items().catch(() => []), api.documentFolders('journal').catch(() => []),
      ]);
      setJournals(next);
      setActors(nextActors);
      setItems(nextItems);
      setFolders(nextFolders);
      if (canManage) setMembers(await api.roomMembers());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取日志');
    }
  }, [canManage]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeJournalNavigation(target => {
    setSelectedJournalId(target.journalId);
    setSelectedPageId(target.pageId ?? null);
  }), []);

  const journal = journals.find(item => item.id === selectedJournalId) ?? null;
  const page = journal?.pages.find(item => item.id === selectedPageId) ?? journal?.pages[0] ?? null;
  const documentViewer = useMemo(() => ({
    userId: viewer?.userId ?? '',
    roomRole: normalizeRoomRole(roomRole),
  }), [viewer?.userId, roomRole]);
  const canEdit = journal ? canUpdateDocument(journal.ownership, documentViewer) : false;
  const canRead = journal ? canReadDocument(journal.ownership, documentViewer) : false;
  const previewCanRead = !previewAsPlayer || journal?.ownership.default === 'observer' || journal?.ownership.default === 'owner';
  const visibleJournals = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return journals.filter(item => !normalized || `${item.name} ${item.pages.map(pageItem => `${pageItem.name} ${pageItem.text}`).join(' ')}`.toLowerCase().includes(normalized));
  }, [journals, query]);

  useEffect(() => { setDraft(page?.text ?? ''); }, [page?.id, page?.text]);

  const createJournal = async () => {
    if (!newJournalName.trim()) return;
    setBusy(true);
    try {
      const created = await api.createJournal(newJournalName.trim());
      setNewJournalName('');
      await load();
      setSelectedJournalId(created.id);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };

  const createPage = async () => {
    if (!journal || !newPageName.trim()) return;
    setBusy(true);
    try {
      const created = await api.createJournalPage(journal.id, { name: newPageName.trim(), type: 'markdown', text: '' });
      setNewPageName('');
      await load();
      setSelectedPageId(created.id);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    setBusy(true);
    try { await api.createDocumentFolder('journal', { name: newFolderName.trim() }); setNewFolderName(''); await load(); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };

  const renameFolder = async (folder: DocumentFolder) => {
    const name = window.prompt('日志目录名称', folder.name)?.trim();
    if (!name || name === folder.name) return;
    setBusy(true);
    try { await api.updateDocumentFolder('journal', folder.id, { name }); await load(); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };

  const deleteFolder = async (folder: DocumentFolder) => {
    if (!confirmAction(`确认删除目录“${folder.name}”？其中日志会移到“未归档”。`)) return;
    setBusy(true);
    try { await api.deleteDocumentFolder('journal', folder.id); await load(); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };

  const deleteCurrentJournal = async () => {
    if (!journal || !confirmAction(`确认删除日志“${journal.name}”及其所有页面和地图标记？`)) return;
    setBusy(true);
    try {
      await api.deleteJournal(journal.id);
      setSelectedJournalId(null); setSelectedPageId(null); await load();
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };

  const uploadHandout = async (file: File | undefined) => {
    if (!journal || !file) return;
    setBusy(true);
    try {
      const asset = await api.uploadAsset(file, 'attachment');
      const type = file.type === 'application/pdf' ? 'pdf' : 'image';
      const created = await api.createJournalPage(journal.id, {
        name: file.name.replace(/\.[^.]+$/u, '') || file.name,
        type,
        assetUrl: asset.url,
      });
      await load();
      setSelectedPageId(created.id);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };

  const savePage = async () => {
    if (!journal || !page) return;
    setBusy(true);
    try {
      await api.updateJournalPage(journal.id, page.id, { text: draft });
      await load();
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };

  const permission = async (ownership: DocumentOwnership) => {
    if (!journal) return;
    setBusy(true);
    try {
      await api.updateJournal(journal.id, { ownership });
      await load();
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };

  const place = (targetPage: JournalPage | null) => {
    if (!journal) return;
    setPendingMapNote({
      journalId: journal.id,
      pageId: targetPage?.id ?? null,
      label: targetPage?.name ?? journal.name,
      icon: 'pin',
      visibility: 'inherit',
    });
  };

  const showPlayers = async () => {
    if (!journal) return;
    connection.sendControl({ type: 'showJournal', journalId: journal.id, pageId: page?.id ?? null });
    await record('handout', `向玩家展示：${journal.name}${page ? ` / ${page.name}` : ''}`, { journalId: journal.id, pageId: page?.id ?? null });
  };

  const insertReference = () => {
    if (!linkId) return;
    const source = linkKind === 'actor' ? actors.find(item => item.id === linkId) : linkKind === 'item' ? items.find(item => item.id === linkId) : journals.find(item => item.id === linkId);
    if (!source) return;
    const type = linkKind === 'actor' ? 'Actor' : linkKind === 'item' ? 'Item' : 'Journal';
    setDraft(current => `${current}${current && !current.endsWith('\n') ? '\n' : ''}[[${type}:${source.id}|${source.name}]]`);
  };

  if (!journal) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {canManage && (
          <div className="space-y-2 border-b border-zinc-800 p-3">
            <div className="flex gap-2">
              <input value={newJournalName} onChange={event => setNewJournalName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void createJournal(); }}
                placeholder="新日志或手册" className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1.5 outline-none focus:ring-1 focus:ring-amber-500" />
              <button onClick={() => void createJournal()} disabled={busy || !newJournalName.trim()} className="rounded bg-amber-500/15 px-3 text-amber-300 disabled:opacity-40">创建</button>
            </div>
            <div className="flex gap-2">
              <input value={newFolderName} onChange={event => setNewFolderName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void createFolder(); }}
                placeholder="新建日志目录" className="min-w-0 flex-1 rounded bg-zinc-900 px-2 py-1 text-xs" />
              <button onClick={() => void createFolder()} disabled={busy || !newFolderName.trim()} className="rounded px-2 text-xs text-sky-300 disabled:opacity-40">新建目录</button>
            </div>
          </div>
        )}
        <div className="border-b border-zinc-800 p-2"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索日志标题与全文" className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs" /></div>
        {error && <p className="px-3 py-2 text-xs text-red-400">{error}</p>}
        <div className="flex-1 overflow-y-auto">
          {journalGroups(visibleJournals, folders).map(group => <div key={group.id}>
            <div className="flex items-center border-b border-zinc-800 bg-zinc-950/60 pr-2 text-[11px] text-zinc-500" style={{ paddingLeft: 12 + group.depth * 14 }}>
              <span className="min-w-0 flex-1 truncate py-1">{group.name} <span className="text-zinc-700">{group.entries.length}</span></span>
              {canManage && group.folder && <>
                <button type="button" disabled={busy} onClick={() => void renameFolder(group.folder!)} title="重命名日志目录" className="px-1 text-zinc-600 hover:text-zinc-200">F2</button>
                <button type="button" disabled={busy} onClick={() => void deleteFolder(group.folder!)} title="删除目录；日志移到未归档" className="px-1 text-zinc-600 hover:text-red-400">×</button>
              </>}
            </div>
            {group.entries.map(item => (
            <button key={item.id} draggable onDragStart={event => event.dataTransfer.setData('application/x-dnd-document', `[[Journal:${item.id}|${item.name}]]`)} onClick={() => setSelectedJournalId(item.id)} className="w-full border-b border-zinc-800/70 px-3 py-2 text-left hover:bg-zinc-800/60">
              <span className="block truncate text-zinc-100">{item.name}</span>
              <span className="text-[11px] text-zinc-500">{item.pages.length ? `${item.pages.length} 页` : canReadDocument(item.ownership, documentViewer) ? '空日志' : 'Limited'}</span>
            </button>
          ))}</div>)}
          {journals.length === 0 && <p className="p-3 text-xs text-zinc-500">还没有可见日志。</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-zinc-800 p-3">
        <div className="flex items-center gap-2">
          <button onClick={() => { setSelectedJournalId(null); setSelectedPageId(null); }} aria-label="返回日志列表" title="返回日志列表" className="text-zinc-400 hover:text-zinc-100">←</button>
          <h3 className="min-w-0 flex-1 truncate font-semibold text-zinc-100">{journal.name}</h3>
          {canManage && <select value={journal.folderId ?? ''} onChange={event => void api.updateJournal(journal.id, { folderId: event.target.value || null }).then(load).catch(cause => setError(message(cause)))}
            title="移动到日志目录" className="max-w-28 rounded bg-zinc-800 px-1 py-1 text-xs text-zinc-300"><option value="">未归档</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>}
          {canManage && <button onClick={() => setPreviewAsPlayer(value => !value)} title="按默认玩家权限预览" className={`rounded px-2 py-1 text-xs ${previewAsPlayer ? 'bg-violet-500/20 text-violet-300' : 'text-zinc-500 hover:bg-zinc-800'}`}>玩家预览</button>}
          {canManage && <button onClick={() => void showPlayers()} className="rounded bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">展示</button>}
          {canManage && <button onClick={() => place(page)} className="rounded bg-sky-500/15 px-2 py-1 text-xs text-sky-300">放置标记</button>}
          {canManage && <button onClick={() => void deleteCurrentJournal()} title="删除日志、所有页面及关联地图标记" className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-950/40">删除</button>}
        </div>
        {canManage && (
          <OwnershipEditor ownership={journal.ownership} members={members} disabled={busy}
            onChange={ownership => void permission(ownership)} />
        )}
      </header>
      {!canRead || !previewCanRead ? (
        <div className="p-4 text-sm text-zinc-500">你可以看到这条日志和地图标记，但没有打开正文的权限。</div>
      ) : (
        <>
          <div className="flex gap-1 overflow-x-auto border-b border-zinc-800 p-2">
            {journal.pages.map(item => (
              <button key={item.id} onClick={() => setSelectedPageId(item.id)}
                className={`shrink-0 rounded px-2 py-1 text-xs ${page?.id === item.id ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-800'}`}>{item.name}</button>
            ))}
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2 border-b border-zinc-800 p-2">
              <input value={newPageName} onChange={event => setNewPageName(event.target.value)} placeholder="新 Markdown 页面"
                className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 text-xs" />
              <button onClick={() => void createPage()} disabled={busy || !newPageName.trim()} className="rounded px-2 text-xs text-amber-300 disabled:opacity-40">添加页</button>
              <label className="cursor-pointer rounded px-2 py-1 text-xs text-sky-300 hover:bg-zinc-800">
                上传手册
                <input type="file" accept="image/jpeg,image/png,image/webp,image/avif,application/pdf" className="hidden"
                  onChange={event => { void uploadHandout(event.target.files?.[0]); event.currentTarget.value = ''; }} />
              </label>
              <select value={linkKind} onChange={event => { setLinkKind(event.target.value as typeof linkKind); setLinkId(''); }} className="rounded bg-zinc-800 px-1 py-1 text-xs"><option value="actor">Actor</option><option value="item">Item</option><option value="journal">Journal</option></select>
              <select value={linkId} onChange={event => setLinkId(event.target.value)} className="min-w-0 flex-1 rounded bg-zinc-800 px-1 py-1 text-xs"><option value="">选择要插入的文档引用</option>{(linkKind === 'actor' ? actors : linkKind === 'item' ? items : journals).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
              <button type="button" onClick={insertReference} disabled={!linkId} className="rounded px-2 py-1 text-xs text-sky-300 disabled:opacity-40">插入引用</button>
            </div>
          )}
          {page ? page.type !== 'markdown' ? (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {page.type === 'pdf' && page.assetUrl ? (
                <iframe title={page.name} src={page.assetUrl} className="h-full min-h-[28rem] w-full rounded border border-zinc-800 bg-white" />
              ) : page.assetUrl ? (
                <img src={page.assetUrl} alt={page.name} className="mx-auto max-h-full max-w-full rounded border border-zinc-800" />
              ) : <p className="text-xs text-zinc-500">附件不可用。</p>}
            </div>
          ) : canEdit ? (
            <div className="flex min-h-0 flex-1 flex-col p-3">
              <textarea value={draft} onChange={event => setDraft(event.target.value)}
                onDrop={event => { const reference = event.dataTransfer.getData('application/x-dnd-document'); if (reference) { event.preventDefault(); setDraft(current => `${current}\n${reference}`); } }}
                className="min-h-0 flex-1 resize-none rounded bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-200 outline-none ring-1 ring-zinc-800 focus:ring-amber-600" />
              <button onClick={() => void savePage()} disabled={busy || draft === page.text}
                className="mt-2 rounded bg-amber-500/15 py-2 text-xs text-amber-300 disabled:opacity-40">保存页面</button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4"><DocumentText text={page.text || '空页面'} /></div>
          ) : <p className="p-4 text-xs text-zinc-500">日志还没有页面。</p>}
        </>
      )}
      {error && <p className="border-t border-zinc-800 px-3 py-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function normalizeRoomRole(value: string): 'host' | 'dm' | 'assistant_dm' | 'player' | 'spectator' {
  if (value === 'host' || value === 'dm' || value === 'assistant_dm' || value === 'spectator') return value;
  return 'player';
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : '操作失败';
}

function journalGroups(journals: readonly JournalEntryDocument[], folders: readonly DocumentFolder[]) {
  const ordered: { folder: DocumentFolder; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number, seen: Set<string>) => {
    for (const folder of folders.filter(item => item.parentId === parentId).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-CN'))) {
      if (seen.has(folder.id)) continue;
      ordered.push({ folder, depth });
      visit(folder.id, depth + 1, new Set(seen).add(folder.id));
    }
  };
  visit(null, 0, new Set());
  const result: Array<{ id: string; name: string; depth: number; entries: JournalEntryDocument[]; folder: DocumentFolder | null }> = [
    { id: 'unfiled', name: '未归档', depth: 0, entries: journals.filter(item => !item.folderId), folder: null },
  ];
  for (const item of ordered) result.push({ id: item.folder.id, name: item.folder.name, depth: item.depth, entries: journals.filter(journal => journal.folderId === item.folder.id), folder: item.folder });
  return result.filter(group => group.id !== 'unfiled' || group.entries.length > 0);
}
