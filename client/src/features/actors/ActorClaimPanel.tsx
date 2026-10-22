import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type RoomMemberSummary } from '../../api';
import {
  canUpdateDocument,
  documentOwnershipLevel,
  type ActorClaim,
  type ActorDocument,
  type DocumentOwnership,
  type DocumentOwnershipLevel,
  type DocumentFolder,
  type ItemDocument,
  type ActorDocumentType,
  normalizeActorSystem,
} from '../../types';
import { connection, useScene } from '../../ws';
import { setPending } from '../../pending';
import OwnershipEditor from '../../documents/OwnershipEditor';
import ActorSheet from './ActorSheet';
import { subscribeActorNavigation } from './navigation';
import { useTabletopSettings } from '../settings/TabletopSettingsContext';
import { extensionRegistry } from '../../extensions/registry';

export default function ActorClaimPanel() {
  const { roomRole, viewer, scene } = useScene();
  const [actors, setActors] = useState<ActorDocument[]>([]);
  const [claim, setClaim] = useState<ActorClaim | null>(null);
  const [name, setName] = useState('');
  const [actorType, setActorType] = useState<ActorDocumentType>('character');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<RoomMemberSummary[]>([]);
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [itemLibrary, setItemLibrary] = useState<ItemDocument[]>([]);
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkFolderId, setBulkFolderId] = useState('');
  const [bulkAccess, setBulkAccess] = useState<DocumentOwnershipLevel>('none');
  const isPlayer = roomRole === 'player';
  const canManage = roomRole === 'host' || roomRole === 'dm' || roomRole === 'assistant_dm';
  const { confirmAction } = useTabletopSettings();

  const load = useCallback(async () => {
    try {
      const [directory, nextFolders] = await Promise.all([api.actors(), api.documentFolders('actor').catch(() => [])]);
      setActors(directory.actors);
      setClaim(directory.claim);
      setFolders(nextFolders);
      const [nextMembers, nextItems] = await Promise.all([
        canManage ? api.roomMembers() : Promise.resolve([]),
        api.items().catch(() => []),
      ]);
      if (canManage) setMembers(nextMembers);
      setItemLibrary(nextItems);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取角色目录');
    }
  }, [canManage]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeActorNavigation(setSelectedActorId), []);

  const reconnect = () => {
    const slug = connection.roomSlug;
    if (!slug) return;
    connection.disconnect();
    connection.connect(slug);
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const actor = await api.createActor({ name: name.trim(), actorType: isPlayer ? 'character' : actorType });
      setName('');
      if (isPlayer) {
        await api.claimActor(actor.id);
        void extensionRegistry.emit('actorClaimed', { actorId: actor.id, userId: viewer?.userId ?? null });
      }
      await load();
      if (isPlayer) reconnect();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法创建角色');
    } finally { setBusy(false); }
  };

  const claimActor = async (actorId: string) => {
    setBusy(true);
    try {
      await api.claimActor(actorId);
      void extensionRegistry.emit('actorClaimed', { actorId, userId: viewer?.userId ?? null });
      await load();
      reconnect();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法认领角色');
    } finally { setBusy(false); }
  };

  const release = async (actorId: string) => {
    setBusy(true);
    try {
      await api.releaseActor(actorId);
      void extensionRegistry.emit('actorReleased', { actorId, userId: viewer?.userId ?? null });
      await load();
      reconnect();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法释放角色');
    } finally { setBusy(false); }
  };

  const actorDirectorySections = extensionRegistry.listActorDirectorySections();
  const externalActorImported = async (actorId: string) => {
    void extensionRegistry.emit('actorClaimed', { actorId, userId: viewer?.userId ?? null });
    await load();
    reconnect();
    setSelectedActorId(actorId);
  };

  const updatePermissions = async (actor: ActorDocument, ownership: DocumentOwnership) => {
    setBusy(true);
    try {
      await api.updateActor(actor.id, { ownership });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法修改角色权限');
    } finally { setBusy(false); }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    setBusy(true);
    try {
      await api.createDocumentFolder('actor', { name: newFolderName.trim() });
      setNewFolderName('');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法创建目录'); } finally { setBusy(false); }
  };

  const moveActors = async (ids: readonly string[], folderId: string | null) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      await Promise.all(ids.map(id => api.updateActor(id, { folderId })));
      setSelectedIds(new Set());
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法移动角色'); } finally { setBusy(false); }
  };

  const applyBulkAccess = async () => {
    const targets = actors.filter(actor => selectedIds.has(actor.id));
    if (!targets.length) return;
    setBusy(true);
    try {
      await Promise.all(targets.map(actor => api.updateActor(actor.id, { ownership: { ...actor.ownership, default: bulkAccess } })));
      setSelectedIds(new Set());
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法批量修改权限'); } finally { setBusy(false); }
  };

  const removeActors = async (ids: readonly string[]) => {
    if (!ids.length || !confirmAction(`确认删除所选 ${ids.length} 个 Actor？已放置的地图 Token 会保留为场景实例。`)) return;
    setBusy(true);
    try {
      await Promise.all(ids.map(id => api.deleteActor(id)));
      setSelectedIds(new Set());
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法删除角色'); } finally { setBusy(false); }
  };

  const duplicateActor = async (actor: ActorDocument) => {
    setBusy(true);
    try {
      const copy = await api.createActor({
        name: `${actor.name} 副本`, actorType: actor.actorType, avatar: actor.avatar,
        system: actor.system, prototypeToken: actor.prototypeToken, ownership: actor.ownership,
      });
      if (actor.folderId) await api.updateActor(copy.id, { folderId: actor.folderId });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法复制角色'); } finally { setBusy(false); }
  };

  const pickUpActor = (actor: ActorDocument) => {
    const system = normalizeActorSystem(actor.system);
    const prototype = actor.prototypeToken;
    const maximum = Math.max(0, Math.round(system.hitPoints.max));
    const current = Math.max(0, Math.min(maximum, Math.round(system.hitPoints.current)));
    setPending({
      kind: actor.actorType === 'character' ? 'player' : actor.actorType,
      actorId: actor.id,
      name: prototype.name.trim() || actor.name,
      entryId: null,
      avatar: prototype.avatar || actor.avatar,
      color: prototype.color,
      size: prototype.size,
      hidden: prototype.hidden,
      hpVisibility: prototype.hpVisibility,
      ...(maximum > 0 ? { hp: { current, max: maximum } } : {}),
    });
  };

  const savedActor = (updated: ActorDocument) => {
    setActors(current => current.map(actor => actor.id === updated.id ? updated : actor));
    if (!scene) return;
    const name = updated.prototypeToken.name.trim() || updated.name;
    const avatar = updated.prototypeToken.avatar || updated.avatar;
    const linkedTokens = scene.tokens.filter(token => token.actorId === updated.id);
    const linkedPlayers = scene.players.filter(token => token.actorId === updated.id);
    connection.sendOps([
      ...linkedTokens.map(token => ({ op: 'updateToken' as const, tokenId: token.id, patch: {
        name, avatar, color: updated.prototypeToken.color,
      } })),
      ...linkedPlayers.map(token => ({ op: 'updatePlayer' as const, tokenId: token.id, patch: {
        name, avatar, color: updated.prototypeToken.color,
      } })),
    ]);
  };

  const orderedFolders = useMemo(() => orderFolders(folders), [folders]);

  const documentViewer = { userId: viewer?.userId ?? '', roomRole: normalizeRoomRole(roomRole) };
  const selectedActor = actors.find(actor => actor.id === selectedActorId) ?? null;
  if (selectedActor) {
    return <ActorSheet actor={selectedActor} itemLibrary={itemLibrary}
      canEdit={canUpdateDocument(selectedActor.ownership, documentViewer)}
      onClose={() => setSelectedActorId(null)}
      onSaved={savedActor} />;
  }
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-zinc-800 p-3">
        <h3 className="font-semibold text-zinc-100">Actor 角色目录</h3>
        <p className="mt-1 text-[11px] leading-4 text-zinc-500">角色是持久文档；认领只决定当前控制者，地图 Token 是场景实例。</p>
        {actorDirectorySections.map(registration => {
          const Section = registration.component;
          return <Section key={registration.id} roomRole={roomRole} busy={busy} onBusy={setBusy} onError={setError} onImported={externalActorImported} />;
        })}
        <div className="mt-3 flex gap-2">
          <input value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void create(); }}
            placeholder="新角色名称" className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1.5 outline-none focus:ring-1 focus:ring-amber-500" />
          {canManage && <select value={actorType} onChange={event => setActorType(event.target.value as ActorDocumentType)} title="Actor 类型" className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
            <option value="character">角色</option><option value="npc">NPC</option><option value="monster">怪物</option>
          </select>}
          <button type="button" onClick={() => void create()} disabled={busy || !name.trim()}
            className="rounded bg-amber-500/15 px-3 text-amber-300 hover:bg-amber-500/25 disabled:opacity-40">{isPlayer ? '创建并认领' : '创建'}</button>
        </div>
        {canManage && (
          <div className="mt-2 flex gap-2">
            <input value={newFolderName} onChange={event => setNewFolderName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void createFolder(); }}
              placeholder="新建角色目录" className="min-w-0 flex-1 rounded bg-zinc-900 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-600" />
            <button type="button" onClick={() => void createFolder()} disabled={busy || !newFolderName.trim()} className="rounded px-2 text-xs text-sky-300 hover:bg-zinc-800 disabled:opacity-40">新建目录</button>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>
      {canManage && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-amber-700/40 bg-amber-950/20 p-2 text-xs">
          <span className="mr-1 text-amber-300">已选 {selectedIds.size}</span>
          <select value={bulkFolderId} onChange={event => setBulkFolderId(event.target.value)} className="rounded bg-zinc-800 px-1 py-1">
            <option value="">未归档</option>{orderedFolders.map(({ folder, depth }) => <option key={folder.id} value={folder.id}>{'　'.repeat(depth)}{folder.name}</option>)}
          </select>
          <button type="button" onClick={() => void moveActors([...selectedIds], bulkFolderId || null)} className="rounded px-2 py-1 text-sky-300 hover:bg-zinc-800">移动</button>
          <select value={bulkAccess} onChange={event => setBulkAccess(event.target.value as DocumentOwnershipLevel)} className="rounded bg-zinc-800 px-1 py-1">
            <option value="none">玩家不可见</option><option value="limited">仅名称</option><option value="observer">可阅读</option><option value="owner">可编辑</option>
          </select>
          <button type="button" onClick={() => void applyBulkAccess()} className="rounded px-2 py-1 text-violet-300 hover:bg-zinc-800">应用权限</button>
          <button type="button" onClick={() => void removeActors([...selectedIds])} className="ml-auto rounded px-2 py-1 text-red-400 hover:bg-red-950/40">删除</button>
          <button type="button" onClick={() => setSelectedIds(new Set())} className="rounded px-2 py-1 text-zinc-500 hover:bg-zinc-800">取消选择</button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {renderDirectoryGroups(actors, orderedFolders).map(group => <div key={group.key}>
          <FolderHeader group={group} canManage={canManage} busy={busy} confirmAction={confirmAction}
            onMove={ids => void moveActors(ids, group.folder?.id ?? null)}
            onReload={() => void load()} onBusy={setBusy} onError={setError} />
          {group.actors.map(actor => {
          const claimed = claim?.actorId === actor.id;
          const level = documentOwnershipLevel(actor.ownership, documentViewer);
          const ownable = canUpdateDocument(actor.ownership, documentViewer);
          return (
            <article key={actor.id} draggable onDragStart={event => {
              event.dataTransfer.effectAllowed = 'copy';
              event.dataTransfer.setData('application/x-dnd-document', `[[Actor:${actor.id}|${actor.name}]]`);
              event.dataTransfer.setData('application/x-dnd-actor-id', actor.id);
            }} className={`border-b border-zinc-800/70 p-3 ${claimed ? 'bg-emerald-950/20 ring-1 ring-inset ring-emerald-700/40' : ''}`}>
              <div className="flex items-center gap-2">
                {canManage && <input type="checkbox" checked={selectedIds.has(actor.id)} aria-label={`选择 ${actor.name}`}
                  onChange={event => setSelectedIds(current => toggleSet(current, actor.id, event.target.checked))} />}
                <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-800 text-xs text-zinc-400">
                  {actor.avatar ? <img src={actor.avatar} alt="" className="h-full w-full object-cover" /> : actor.name.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => setSelectedActorId(actor.id)} className="block w-full truncate text-left font-medium text-zinc-100 hover:text-amber-300">{actor.name}</button>
                  <div className="text-[11px] text-zinc-500">{actor.actorType} · {level}</div>
                </div>
                {isPlayer && ownable && (claimed ? (
                  <button type="button" disabled={busy} onClick={() => void release(actor.id)} className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800">释放</button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => void claimActor(actor.id)} className="rounded bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">认领</button>
                ))}
                <button type="button" onClick={() => setSelectedActorId(actor.id)} title="打开完整角色卡" className="rounded px-2 py-1 text-xs text-sky-300 hover:bg-zinc-800">角色卡</button>
                {canManage && <button type="button" onClick={() => pickUpActor(actor)} title="拿起 Actor 的原型 Token，随后点击地图放置" className="rounded px-1 py-1 text-[11px] text-amber-300 hover:bg-zinc-800">放置</button>}
                {canManage && <button type="button" disabled={busy} onClick={() => void duplicateActor(actor)} title="复制为独立 Actor 文档" className="rounded px-1 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800">复制</button>}
              </div>
              {canManage && (
                <OwnershipEditor ownership={actor.ownership} members={members} disabled={busy}
                  onChange={ownership => void updatePermissions(actor, ownership)} />
              )}
            </article>
          );
        })}</div>)}
        {actors.length === 0 && <p className="p-3 text-xs text-zinc-500">还没有可见角色。创建角色后会自动完成认领。</p>}
      </div>
    </div>
  );
}

interface OrderedFolder { folder: DocumentFolder; depth: number }
interface ActorGroup { key: string; folder: DocumentFolder | null; depth: number; actors: ActorDocument[] }

function orderFolders(folders: readonly DocumentFolder[]): OrderedFolder[] {
  const result: OrderedFolder[] = [];
  const visit = (parentId: string | null, depth: number, visited: Set<string>) => {
    for (const folder of folders.filter(item => item.parentId === parentId).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-CN'))) {
      if (visited.has(folder.id)) continue;
      const next = new Set(visited).add(folder.id);
      result.push({ folder, depth });
      visit(folder.id, depth + 1, next);
    }
  };
  visit(null, 0, new Set());
  for (const folder of folders) if (!result.some(item => item.folder.id === folder.id)) result.push({ folder, depth: 0 });
  return result;
}

function renderDirectoryGroups(actors: readonly ActorDocument[], folders: readonly OrderedFolder[]): ActorGroup[] {
  const groups: ActorGroup[] = [{ key: 'unfiled', folder: null, depth: 0, actors: actors.filter(actor => !actor.folderId) }];
  for (const item of folders) groups.push({ key: item.folder.id, folder: item.folder, depth: item.depth, actors: actors.filter(actor => actor.folderId === item.folder.id) });
  return groups.filter(group => group.folder || group.actors.length > 0);
}

function FolderHeader({ group, canManage, busy, onMove, onReload, onBusy, onError, confirmAction }: {
  group: ActorGroup; canManage: boolean; busy: boolean; onMove(ids: string[]): void;
  onReload(): void; onBusy(value: boolean): void; onError(value: string): void; confirmAction(message: string): boolean;
}) {
  if (!group.folder) return <div className="border-b border-zinc-800 bg-zinc-950/40 px-3 py-1 text-[11px] text-zinc-500">未归档</div>;
  const rename = async () => {
    const name = window.prompt('目录名称', group.folder!.name);
    if (!name?.trim()) return;
    onBusy(true);
    try { await api.updateDocumentFolder('actor', group.folder!.id, { name: name.trim() }); onReload(); }
    catch (cause) { onError(cause instanceof Error ? cause.message : '无法修改目录'); } finally { onBusy(false); }
  };
  const remove = async () => {
    if (!confirmAction(`删除目录“${group.folder!.name}”？其中角色会移到未归档。`)) return;
    onBusy(true);
    try { await api.deleteDocumentFolder('actor', group.folder!.id); onReload(); }
    catch (cause) { onError(cause instanceof Error ? cause.message : '无法删除目录'); } finally { onBusy(false); }
  };
  return (
    <div onDragOver={event => event.preventDefault()} onDrop={event => {
      const id = event.dataTransfer.getData('application/x-dnd-actor-id');
      if (id) { event.preventDefault(); onMove([id]); }
    }} className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-950/60 py-1 pr-2 text-xs text-zinc-400" style={{ paddingLeft: 12 + group.depth * 14 }}>
      <span aria-hidden>▾</span><span className="min-w-0 flex-1 truncate">{group.folder.name}</span><span className="text-[10px] text-zinc-600">{group.actors.length}</span>
      {canManage && <button type="button" disabled={busy} onClick={() => void rename()} title="重命名目录" className="px-1 hover:text-zinc-100">重命名</button>}
      {canManage && <button type="button" disabled={busy} onClick={() => void remove()} title="删除目录；角色不会被删除" className="px-1 hover:text-red-400">删除</button>}
    </div>
  );
}

function toggleSet(current: Set<string>, id: string, checked: boolean): Set<string> {
  const next = new Set(current);
  if (checked) next.add(id); else next.delete(id);
  return next;
}

function normalizeRoomRole(value: string): 'host' | 'dm' | 'assistant_dm' | 'player' | 'spectator' {
  if (value === 'host' || value === 'dm' || value === 'assistant_dm' || value === 'spectator') return value;
  return 'player';
}
