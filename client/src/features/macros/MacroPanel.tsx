import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type RoomMemberSummary } from '../../api';
import { registerCoreExtension, rollFormula } from '../../extensions/core';
import { extensionRegistry } from '../../extensions/registry';
import type { DocumentFolder, DocumentOwnership, JsonValue, MacroDocument } from '../../types';
import { connection, useScene } from '../../ws';
import OwnershipEditor from '../../documents/OwnershipEditor';
import { useTabletopSettings } from '../settings/TabletopSettingsContext';

registerCoreExtension();

interface Props {
  onSelectTool?: (tool: string) => void;
}

export default function MacroPanel({ onSelectTool }: Props) {
  const { scene, roomRole } = useScene();
  const [macros, setMacros] = useState<MacroDocument[]>([]);
  const commands = useMemo(() => extensionRegistry.listCommands(), []);
  const [name, setName] = useState('');
  const [commandId, setCommandId] = useState(commands[0]?.id ?? 'core.dice.roll');
  const [argument, setArgument] = useState('1d20');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [members, setMembers] = useState<RoomMemberSummary[]>([]);
  const [folderId, setFolderId] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [busy, setBusy] = useState(false);
  const canManage = roomRole === 'host' || roomRole === 'dm' || roomRole === 'assistant_dm';
  const { confirmAction } = useTabletopSettings();

  const load = useCallback(async () => {
    try {
      const [nextMacros, nextFolders, nextMembers] = await Promise.all([
        api.macros(), api.documentFolders('macro').catch(() => []), canManage ? api.roomMembers() : Promise.resolve([]),
      ]);
      setMacros(nextMacros); setFolders(nextFolders); setMembers(nextMembers); setError('');
      window.dispatchEvent(new Event('dndboard:macros-changed'));
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取宏'); }
  }, [canManage]);
  useEffect(() => { void load(); }, [load]);

  const argsFor = (id: string): Record<string, JsonValue> => {
    if (id === 'core.dice.roll') return { formula: argument.trim() || '1d20' };
    if (id === 'core.ui.select-tool') return { tool: argument.trim() || 'select' };
    return {};
  };

  const create = async () => {
    if (!name.trim()) return;
    try {
      await api.createMacro({
        name: name.trim(),
        command: { commandId, args: argsFor(commandId) },
        ownership: { default: 'observer', users: {} },
        folderId: folderId || null,
      });
      setName('');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法创建宏'); }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    setBusy(true);
    try { await api.createDocumentFolder('macro', { name: newFolderName.trim() }); setNewFolderName(''); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法创建宏目录'); } finally { setBusy(false); }
  };

  const move = async (macro: MacroDocument, nextFolderId: string) => {
    try { await api.updateMacro(macro.id, { folderId: nextFolderId || null }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法移动宏'); }
  };

  const permission = async (macro: MacroDocument, ownership: DocumentOwnership) => {
    try { await api.updateMacro(macro.id, { ownership }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法修改宏权限'); }
  };

  const rename = async (macro: MacroDocument) => {
    const next = window.prompt('宏名称', macro.name)?.trim();
    if (!next || next === macro.name) return;
    try { await api.updateMacro(macro.id, { name: next }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法重命名宏'); }
  };

  const remove = async (macro: MacroDocument) => {
    if (!confirmAction(`删除宏“${macro.name}”？所有用户快捷栏中的对应绑定也会清除。`)) return;
    try { await api.deleteMacro(macro.id); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法删除宏'); }
  };

  const renameFolder = async (folder: DocumentFolder) => {
    const next = window.prompt('宏目录名称', folder.name)?.trim();
    if (!next || next === folder.name) return;
    try { await api.updateDocumentFolder('macro', folder.id, { name: next }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法重命名宏目录'); }
  };

  const removeFolder = async (folder: DocumentFolder) => {
    if (!confirmAction(`删除宏目录“${folder.name}”？其中宏会移到未归档。`)) return;
    try { await api.deleteDocumentFolder('macro', folder.id); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法删除宏目录'); }
  };

  const execute = async (macro: MacroDocument) => {
    try {
      await extensionRegistry.execute(macro.command, {
        roomRole,
        sceneId: scene?.id ?? null,
        sendOps: operations => connection.sendOps(operations),
        roll: formula => rollFormula(formula),
        selectTool: onSelectTool,
        notify: setNotice,
      });
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '宏执行失败'); }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {canManage && (
        <div className="space-y-2 border-b border-zinc-800 p-3">
          <input value={name} onChange={event => setName(event.target.value)} placeholder="宏名称" className="w-full rounded bg-zinc-800 px-2 py-1.5" />
          <select value={commandId} onChange={event => setCommandId(event.target.value)} className="w-full rounded bg-zinc-800 px-2 py-1.5">
            {commands.map(command => <option key={command.id} value={command.id}>{command.title} · {command.id}</option>)}
          </select>
          {(commandId === 'core.dice.roll' || commandId === 'core.ui.select-tool') && (
            <input value={argument} onChange={event => setArgument(event.target.value)}
              placeholder={commandId === 'core.dice.roll' ? '例如 1d20+5' : 'select / multi / wall / erase / zoom'}
              className="w-full rounded bg-zinc-800 px-2 py-1.5 font-mono text-xs" />
          )}
          <select value={folderId} onChange={event => setFolderId(event.target.value)} className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs">
            <option value="">未归档</option>{orderedFolders(folders).map(({ folder, depth }) => <option key={folder.id} value={folder.id}>{'　'.repeat(depth)}{folder.name}</option>)}
          </select>
          <button onClick={() => void create()} disabled={!name.trim()} className="w-full rounded bg-amber-500/15 py-2 text-xs text-amber-300 disabled:opacity-40">保存声明式宏</button>
          <div className="flex gap-1"><input value={newFolderName} onChange={event => setNewFolderName(event.target.value)} placeholder="新建宏目录" className="min-w-0 flex-1 rounded bg-zinc-950 px-2 py-1 text-xs" /><button type="button" onClick={() => void createFolder()} disabled={busy || !newFolderName.trim()} className="rounded px-2 text-xs text-sky-300 disabled:opacity-40">新建目录</button></div>
        </div>
      )}
      {notice && <div className="border-b border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">{notice}</div>}
      {error && <div className="border-b border-red-900/50 px-3 py-2 text-xs text-red-400">{error}</div>}
      <div className="flex-1 overflow-y-auto">
        {macroGroups(macros, folders).map(group => <section key={group.id}>
          <header className="flex items-center border-b border-zinc-800 bg-zinc-950/60 py-1 pr-2 text-[11px] text-zinc-500" style={{ paddingLeft: 12 + group.depth * 14 }}>
            <span className="min-w-0 flex-1 truncate">{group.name} <span className="text-zinc-700">{group.entries.length}</span></span>
            {canManage && group.folder && <><button type="button" onClick={() => void renameFolder(group.folder!)} title="重命名宏目录" className="px-1 hover:text-zinc-200">F2</button><button type="button" onClick={() => void removeFolder(group.folder!)} title="删除目录；宏移到未归档" className="px-1 hover:text-red-300">×</button></>}
          </header>
          {group.entries.map(macro => (
            <article key={macro.id} draggable onDragStart={event => {
              event.dataTransfer.effectAllowed = 'copy';
              event.dataTransfer.setData('application/x-dnd-macro-id', macro.id);
              event.dataTransfer.setData('text/plain', macro.id);
            }} className="cursor-grab border-b border-zinc-800/70 px-3 py-2 active:cursor-grabbing">
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => void execute(macro)} title="执行宏；也可拖到底部快捷栏绑定" className="min-w-0 flex-1 text-left hover:text-amber-300"><span className="block truncate text-zinc-100">{macro.name}</span><span className="block truncate font-mono text-[10px] text-zinc-500">{macro.command.commandId}</span></button>
                {canManage && <select value={macro.folderId ?? ''} onChange={event => void move(macro, event.target.value)} title="移动到宏目录" className="max-w-24 rounded bg-zinc-800 px-1 py-1 text-[10px]"><option value="">未归档</option>{orderedFolders(folders).map(({ folder, depth }) => <option key={folder.id} value={folder.id}>{'　'.repeat(depth)}{folder.name}</option>)}</select>}
                {canManage && <button type="button" onClick={() => void rename(macro)} title="重命名宏" className="px-1 text-[10px] text-zinc-500 hover:text-zinc-200">F2</button>}
                {canManage && <button type="button" onClick={() => void remove(macro)} title="删除宏及快捷栏绑定" aria-label={`删除宏 ${macro.name}`} className="px-1 text-zinc-600 hover:text-red-300">×</button>}
              </div>
              {canManage && <OwnershipEditor ownership={macro.ownership} members={members} onChange={ownership => void permission(macro, ownership)} />}
            </article>
          ))}
        </section>)}
        {macros.length === 0 && <p className="p-3 text-xs text-zinc-500">还没有宏。宏只调用已安装扩展注册的命令，不执行任意脚本。</p>}
      </div>
    </div>
  );
}

function orderedFolders(folders: readonly DocumentFolder[]): Array<{ folder: DocumentFolder; depth: number }> {
  const result: Array<{ folder: DocumentFolder; depth: number }> = [];
  const visit = (parentId: string | null, depth: number, seen: Set<string>) => {
    for (const folder of folders.filter(item => item.parentId === parentId).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-CN'))) {
      if (seen.has(folder.id)) continue;
      result.push({ folder, depth });
      visit(folder.id, depth + 1, new Set(seen).add(folder.id));
    }
  };
  visit(null, 0, new Set());
  return result;
}

function macroGroups(macros: readonly MacroDocument[], folders: readonly DocumentFolder[]) {
  const groups: Array<{ id: string; name: string; depth: number; folder: DocumentFolder | null; entries: MacroDocument[] }> = [];
  const unfiled = macros.filter(macro => !macro.folderId);
  if (unfiled.length) groups.push({ id: 'unfiled', name: '未归档', depth: 0, folder: null, entries: unfiled });
  for (const { folder, depth } of orderedFolders(folders)) groups.push({ id: folder.id, name: folder.name, depth, folder, entries: macros.filter(macro => macro.folderId === folder.id) });
  return groups;
}
