import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import ExplorerRow, { ExplorerAction } from '../../components/explorer/ExplorerRow';
import type { ActorAction, ItemDocument, ItemDocumentType, JsonValue } from '../../types';
import { useScene } from '../../ws';
import { subscribeToolNavigation } from './navigation';
import { useTabletopSettings } from '../settings/TabletopSettingsContext';

const TYPES: Array<{ value: ItemDocumentType; label: string }> = [
  { value: 'weapon', label: '武器' }, { value: 'armor', label: '护甲' }, { value: 'spell', label: '法术' },
  { value: 'consumable', label: '消耗品' }, { value: 'feat', label: '能力' }, { value: 'equipment', label: '装备' }, { value: 'loot', label: '战利品' },
];

export default function ItemLibraryPanel() {
  const { role } = useScene();
  const canManage = role === 'dm';
  const [items, setItems] = useState<ItemDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ItemDocumentType>('weapon');
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setItems(await api.items()); setError(''); } catch (cause) { setError(message(cause)); } }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeToolNavigation(target => { if (target.type === 'item' && target.id) setSelectedId(target.id); }), []);
  const selected = items.find(item => item.id === selectedId) ?? null;
  const visible = useMemo(() => items.filter(item => `${item.name} ${item.folder} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase())), [items, query]);

  const create = async () => {
    if (!newName.trim()) return;
    try {
      const created = await api.createToolDocument<ItemDocument>('item', {
        name: newName.trim(), ownership: { default: 'observer', users: {} },
        data: { itemType: newType, image: '', description: '', system: {}, actions: [], effects: [] },
      });
      setNewName(''); setItems(current => [...current, created]); setSelectedId(created.id);
    } catch (cause) { setError(message(cause)); }
  };

  if (selected) return <ItemEditor item={selected} canManage={canManage} onBack={() => setSelectedId(null)} onSaved={updated => setItems(current => current.map(item => item.id === updated.id ? updated : item))} />;

  const folders = [...new Set(visible.map(item => item.folder || '未分组'))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return <div className="flex h-full flex-col overflow-hidden">
    <div className="space-y-2 border-b border-zinc-800 p-2"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索物品、法术或说明" className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs" />
      {canManage && <div className="flex gap-1"><input value={newName} onChange={event => setNewName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void create(); }} placeholder="新物品名称" className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 text-xs" /><select value={newType} onChange={event => setNewType(event.target.value as ItemDocumentType)} className="rounded bg-zinc-800 px-1 text-xs">{TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select><button onClick={() => void create()} className="rounded bg-amber-500/15 px-2 text-xs text-amber-300">新建</button></div>}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
    <div className="flex-1 overflow-y-auto">{folders.map(folder => <section key={folder}><ExplorerRow depth={0} kind="folder" expanded label={<>{folder} <span className="text-zinc-600">{visible.filter(item => (item.folder || '未分组') === folder).length}</span></>} />{visible.filter(item => (item.folder || '未分组') === folder).map(item => <ExplorerRow key={item.id} depth={1} kind="file" onClick={() => setSelectedId(item.id)} label={<>{item.name} <span className="text-zinc-600">{typeLabel(item.itemType)}</span></>} actions={canManage ? <ExplorerAction label={item.locked ? '锁' : '编'} title="打开编辑" onClick={() => setSelectedId(item.id)} /> : undefined} />)}</section>)}{visible.length === 0 && <p className="p-3 text-xs text-zinc-500">没有物品文档。</p>}</div>
  </div>;
}

function ItemEditor({ item, canManage, onBack, onSaved }: { item: ItemDocument; canManage: boolean; onBack(): void; onSaved(value: ItemDocument): void }) {
  const { confirmAction } = useTabletopSettings();
  const [draft, setDraft] = useState(item);
  const [newAction, setNewAction] = useState({ name: '', formula: '1d20', damageFormula: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.updateToolDocument<ItemDocument>('item', item.id, { name: draft.name, folder: draft.folder, locked: draft.locked, data: itemData(draft) });
      onSaved(updated); setDraft(updated); setError('');
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirmAction(`删除“${item.name}”？已加入角色卡的独立副本不会被删除。`)) return;
    try { await api.deleteToolDocument('item', item.id); onBack(); } catch (cause) { setError(message(cause)); }
  };
  const addAction = () => {
    if (!newAction.name.trim() || !newAction.formula.trim()) return;
    const action: ActorAction = { id: crypto.randomUUID(), name: newAction.name.trim(), kind: 'attack', formula: newAction.formula.trim(), ...(newAction.damageFormula.trim() ? { damageFormula: newAction.damageFormula.trim() } : {}) };
    setDraft(current => ({ ...current, actions: [...current.actions, action] })); setNewAction({ name: '', formula: '1d20', damageFormula: '' });
  };
  return <div className="flex h-full flex-col overflow-hidden"><header className="flex items-center gap-2 border-b border-zinc-800 p-3"><button onClick={onBack} className="text-zinc-400">←</button><input value={draft.name} disabled={!canManage} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 font-semibold" />{canManage && <button onClick={() => void save()} disabled={busy} className="rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-300">保存</button>}</header><div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
    <div className="grid grid-cols-2 gap-2"><label><span className="mb-1 block text-zinc-500">类型</span><select value={draft.itemType} disabled={!canManage} onChange={event => setDraft(current => ({ ...current, itemType: event.target.value as ItemDocumentType }))} className="w-full rounded bg-zinc-800 px-2 py-1.5">{TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label><label><span className="mb-1 block text-zinc-500">文件夹路径</span><input value={draft.folder} disabled={!canManage} onChange={event => setDraft(current => ({ ...current, folder: event.target.value }))} placeholder="例如 装备/武器" className="w-full rounded bg-zinc-800 px-2 py-1.5" /></label></div>
    <label className="block"><span className="mb-1 block text-zinc-500">图像 URL</span><input value={draft.image} disabled={!canManage} onChange={event => setDraft(current => ({ ...current, image: event.target.value }))} className="w-full rounded bg-zinc-800 px-2 py-1.5" /></label>
    <label className="block"><span className="mb-1 block text-zinc-500">说明</span><textarea value={draft.description} disabled={!canManage} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} className="min-h-36 w-full rounded bg-zinc-950 p-2 leading-5 ring-1 ring-zinc-800" /></label>
    <section><h4 className="mb-2 text-zinc-400">动作</h4>{draft.actions.map(action => <div key={action.id} className="mb-1 flex items-center gap-2 rounded bg-zinc-950/60 px-2 py-1.5"><span className="min-w-0 flex-1 truncate">{action.name}</span><code className="text-zinc-500">{action.formula}{action.damageFormula ? ` / ${action.damageFormula}` : ''}</code>{canManage && <button onClick={() => setDraft(current => ({ ...current, actions: current.actions.filter(entry => entry.id !== action.id) }))} title={`删除动作 ${action.name}`} aria-label={`删除动作 ${action.name}`} className="text-zinc-600 hover:text-red-300">×</button>}</div>)}{canManage && <div className="grid grid-cols-3 gap-1"><input value={newAction.name} onChange={event => setNewAction(current => ({ ...current, name: event.target.value }))} placeholder="动作名称" className="rounded bg-zinc-800 px-2 py-1" /><input value={newAction.formula} onChange={event => setNewAction(current => ({ ...current, formula: event.target.value }))} placeholder="命中/检定" className="rounded bg-zinc-800 px-2 py-1 font-mono" /><input value={newAction.damageFormula} onChange={event => setNewAction(current => ({ ...current, damageFormula: event.target.value }))} placeholder="伤害（可选）" className="rounded bg-zinc-800 px-2 py-1 font-mono" /><button onClick={addAction} className="col-span-3 rounded bg-zinc-800 py-1">添加动作</button></div>}</section>
    {canManage && <label className="flex items-center gap-2"><input type="checkbox" checked={draft.locked} onChange={event => setDraft(current => ({ ...current, locked: event.target.checked }))} />锁定模板，避免误改或误删</label>}
    {canManage && !draft.locked && <button onClick={() => void remove()} className="w-full rounded border border-red-900/50 py-2 text-red-300">删除物品文档</button>}{error && <p className="text-red-400">{error}</p>}
  </div></div>;
}

function itemData(item: ItemDocument): Record<string, JsonValue> { return { itemType: item.itemType, image: item.image, description: item.description, system: item.system, actions: item.actions as unknown as JsonValue, effects: item.effects as unknown as JsonValue }; }
function typeLabel(value: ItemDocumentType): string { return TYPES.find(type => type.value === value)?.label ?? value; }
function message(cause: unknown): string { return cause instanceof Error ? cause.message : '物品操作失败'; }
