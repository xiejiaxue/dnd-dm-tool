import { useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import type { NpcImportance, NpcPlayerAccess, NpcRecord, NpcStatus, Op } from '../../types';
import { setPending } from '../../pending';
import { connection, useScene } from '../../ws';
import { createNpcToken, npcEntryId, npcTokenColor } from './token';
import { emptyNpc, MAX_IMPORTED_NPCS, MAX_NPC_MARKDOWN_BYTES, parseNpcMarkdown } from './markdown';
import { buildNpcTree, resolveNpcData, searchNpcs, type NpcTreeNode, type ResolvedNpcData } from './model';
import { canonicalizeNpcRecord, deriveNpcStatReference, normalizeNpcMetadata, npcImportanceLabel } from '../../../../shared/npc-metadata';
import ExplorerRow, { ExplorerAction } from '../../components/explorer/ExplorerRow';
import StatBlockView from '../../components/StatBlockView';
import { useResolvedNpcData } from './useResolvedNpcData';
import { useBoardCommands } from '../history/BoardCommandContext';
import { useTabletopSettings } from '../settings/TabletopSettingsContext';

const STATUS_LABEL: Record<NpcStatus, string> = {
  active: '活跃', missing: '失踪', inactive: '退场', dead: '死亡',
};

const IMPORTANCE_LABEL: Record<NpcImportance, string> = {
  major: '主要人物', supporting: '重要配角', minor: '次要人物',
};

const PLAYER_ACCESS_LABEL: Record<NpcPlayerAccess, string> = {
  none: '仅主持人', limited: '公开简介', observer: '公开简介与数据',
};

function sendBatches(operations: Op[]): void {
  let batch: Op[] = [];
  let bytes = 0;
  for (const operation of operations) {
    const operationBytes = new TextEncoder().encode(JSON.stringify(operation)).byteLength;
    if (batch.length > 0 && (batch.length >= 20 || bytes + operationBytes > 48 * 1024)) {
      connection.sendOps(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(operation);
    bytes += operationBytes;
  }
  if (batch.length > 0) connection.sendOps(batch);
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function NpcEditor({ initial, onClose }: { initial: NpcRecord; onClose: () => void }) {
  const { scene } = useScene();
  const normalized = normalizeNpcMetadata(initial);
  const [draft, setDraft] = useState(() => ({ ...normalized, aliases: [...normalized.aliases] }));
  const [aliases, setAliases] = useState(normalized.aliases.join('，'));
  const set = <K extends keyof NpcRecord>(key: K, value: NpcRecord[K]) => setDraft(current => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = draft.name.trim();
    const faction = (draft.faction ?? '').trim() || '未分类';
    if (!name) return;
    const base: NpcRecord = {
      ...draft,
      name: name.slice(0, 120),
      aliases: [...new Set(aliases.split(/[,，、;|]+/u).map(value => value.trim()).filter(Boolean))].slice(0, 12),
      role: draft.role.trim().slice(0, 120),
      location: draft.location.trim().slice(0, 120),
      importance: draft.importance ?? 'supporting',
      faction: faction.slice(0, 120),
      groupPath: [faction.slice(0, 80)],
      notesMarkdown: draft.notesMarkdown.trim().slice(0, 16_000),
      playerAccess: draft.playerAccess ?? 'none',
      publicDescription: (draft.publicDescription ?? '').trim().slice(0, 4_000),
      updatedAt: Date.now(),
    };
    const npc = canonicalizeNpcRecord({ ...base, statReference: deriveNpcStatReference(base) });
    const linkedUpdates: Op[] = (scene?.tokens ?? [])
      .filter(token => token.kind === 'npc' && token.entryId === npcEntryId(npc.id))
      .map(token => ({ op: 'updateToken' as const, tokenId: token.id, patch: { name: npc.name, color: npcTokenColor(npc.status) } }));
    sendBatches([{ op: 'upsertNpc', npc }, ...linkedUpdates]);
    onClose();
  };

  return (
    <form onSubmit={submit} className="flex-1 space-y-3 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onClose} aria-label="返回 NPC 列表" title="返回 NPC 列表" className="text-zinc-400 hover:text-zinc-100">←</button>
        <h3 className="font-semibold text-zinc-100">{initial.name ? '编辑 NPC' : '新建 NPC'}</h3>
      </div>
      <EditorField label="名称"><input autoFocus required value={draft.name} onChange={event => set('name', event.target.value)} maxLength={120} /></EditorField>
      <EditorField label="别名（逗号分隔）"><input value={aliases} onChange={event => setAliases(event.target.value)} maxLength={960} /></EditorField>
      <div className="grid grid-cols-2 gap-2">
        <EditorField label="阵营"><input value={draft.faction ?? ''} onChange={event => set('faction', event.target.value)} maxLength={120} /></EditorField>
        <EditorField label="状态">
          <select value={draft.status} onChange={event => set('status', event.target.value as NpcStatus)}>
            {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </EditorField>
      </div>
      <EditorField label="重要程度">
        <select value={draft.importance ?? 'supporting'} onChange={event => set('importance', event.target.value as NpcImportance)}>
          {Object.entries(IMPORTANCE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </EditorField>
      <EditorField label="玩家权限">
        <select value={draft.playerAccess ?? 'none'} onChange={event => set('playerAccess', event.target.value as NpcPlayerAccess)}>
          {Object.entries(PLAYER_ACCESS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </EditorField>
      <div className="grid grid-cols-2 gap-2">
        <EditorField label="身份 / 作用"><input value={draft.role} onChange={event => set('role', event.target.value)} maxLength={120} /></EditorField>
        <EditorField label="当前位置"><input value={draft.location} onChange={event => set('location', event.target.value)} maxLength={120} /></EditorField>
      </div>
      <EditorField label="玩家公开简介">
        <textarea value={draft.publicDescription ?? ''} onChange={event => set('publicDescription', event.target.value)} maxLength={4_000} rows={6}
          placeholder="只填写玩家当前已经知道的身份、外貌和背景。不会自动复制主持人私密档案。" className="resize-y leading-relaxed" />
      </EditorField>
      <EditorField label="Markdown 档案与专属数据">
        <textarea value={draft.notesMarkdown} onChange={event => set('notesMarkdown', event.target.value)} maxLength={16_000} rows={16}
          placeholder="可写背景、线索；包含护甲等级/生命值表时会作为专属属性数据。" className="resize-y font-mono leading-relaxed" />
      </EditorField>
      {draft.sourceFile && <div className="text-[10px] text-zinc-600">来源：{draft.sourceFile}</div>}
      <div className="flex gap-2">
        <button type="submit" disabled={!draft.name.trim()}
          className="flex-1 border border-sky-700 bg-sky-950/50 px-3 py-2 text-sky-300 hover:bg-sky-900/50 disabled:cursor-not-allowed disabled:opacity-40">保存档案</button>
        <button type="button" onClick={onClose} className="border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-400 hover:bg-zinc-700">取消</button>
      </div>
    </form>
  );
}

function EditorField({ label, children }: { label: string; children: ReactElement }) {
  return (
    <label className="block text-xs text-zinc-400">
      {label}
      <span className="mt-1 block [&>*]:w-full [&>*]:border [&>*]:border-zinc-700 [&>*]:bg-zinc-800 [&>*]:px-2 [&>*]:py-1.5 [&>*]:text-zinc-100 [&>*]:outline-none focus-within:[&>*]:border-sky-500">{children}</span>
    </label>
  );
}

function NpcDetail({ npc, records, onBack, onEdit, onPlace, onPickUp, onDelete, readOnly = false }: {
  npc: NpcRecord;
  records: readonly NpcRecord[];
  onBack: () => void;
  onEdit: () => void;
  onPlace: (data?: ResolvedNpcData) => void;
  onPickUp: (data?: ResolvedNpcData) => void;
  onDelete: () => void;
  readOnly?: boolean;
}) {
  const normalized = normalizeNpcMetadata(npc);
  const showRules = !readOnly || normalized.playerAccess === 'observer';
  const { data: resolved, loading } = useResolvedNpcData(normalized, records, showRules);
  const publicDescription = normalized.publicDescription?.trim() || (readOnly ? normalized.notesMarkdown.trim() : '');

  return (
    <div className="flex-1 overflow-y-auto p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="返回 NPC 列表" title="返回 NPC 列表" className="text-zinc-400 hover:text-zinc-100">←</button>
        <h2 className="min-w-0 flex-1 truncate text-base font-bold text-zinc-100">{normalized.name}</h2>
        <span className="text-[10px] text-zinc-500">{STATUS_LABEL[normalized.status]}</span>
      </div>
      <div className="mb-3 truncate text-[11px] text-zinc-500">{normalized.groupPath?.join(' / ')}</div>
      {(normalized.role || normalized.location) && <div className="mb-2 text-xs text-zinc-400">{[normalized.role, normalized.location].filter(Boolean).join(' · ')}</div>}
      {publicDescription && (
        <div className="mb-3 whitespace-pre-wrap border-l-2 border-sky-800 pl-2 text-xs leading-relaxed text-zinc-300">
          {publicDescription}
        </div>
      )}
      {readOnly && !showRules && <div className="text-xs text-zinc-500">该 NPC 的规则数据未向玩家公开。</div>}
      {loading && <div className="text-xs text-zinc-500">正在载入数据…</div>}
      {resolved && (
        <>
          <div className="mb-2 border-l-2 border-zinc-700 pl-2 text-[10px] text-zinc-500">数据：{resolved.sourceLabel}</div>
          <StatBlockView stat={resolved.stat} />
        </>
      )}
      {!readOnly && <div className="mt-4 grid grid-cols-2 gap-2 border-t border-zinc-800 pt-3">
        <button type="button" onClick={() => onPlace(resolved ?? undefined)} className="border border-amber-800 bg-amber-950/40 py-1.5 text-amber-300 hover:bg-amber-900/40">添加到地图</button>
        <button type="button" onClick={() => onPickUp(resolved ?? undefined)} className="border border-zinc-700 bg-zinc-800 py-1.5 text-zinc-200 hover:bg-zinc-700">拿起放置</button>
        <button type="button" onClick={onEdit} className="border border-zinc-700 py-1.5 text-zinc-400 hover:bg-zinc-800">编辑</button>
        <button type="button" onClick={onDelete} className="border border-zinc-800 py-1.5 text-zinc-500 hover:border-red-900 hover:bg-red-950/30 hover:text-red-300">删除</button>
      </div>}
    </div>
  );
}

function NpcTree({ nodes, depth, closed, onToggle, onOpen, onPlace, tokenCounts, readOnly = false }: {
  nodes: readonly NpcTreeNode[];
  depth: number;
  closed: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onOpen: (npc: NpcRecord) => void;
  onPlace: (npc: NpcRecord) => void;
  tokenCounts: ReadonlyMap<string, number>;
  readOnly?: boolean;
}) {
  return <>{nodes.map(node => {
    if (node.type === 'folder') {
      const isClosed = closed.has(node.key);
      return (
        <div key={node.key}>
          <ExplorerRow depth={depth} kind="folder" expanded={!isClosed} onClick={() => onToggle(node.key)}
            label={<>{node.name} <span className="text-zinc-600">{node.count}</span></>} />
          {!isClosed && <NpcTree nodes={node.children} depth={depth + 1} closed={closed} onToggle={onToggle} onOpen={onOpen} onPlace={onPlace} tokenCounts={tokenCounts} readOnly={readOnly} />}
        </div>
      );
    }
    const count = tokenCounts.get(node.npc.id) ?? 0;
    const access = node.npc.playerAccess ?? 'none';
    return (
      <ExplorerRow key={node.key} depth={depth} kind="file" onClick={() => onOpen(node.npc)} title={node.npc.name}
        label={<>{node.npc.name}<span className="ml-1 text-[10px] text-zinc-600">{npcImportanceLabel(node.npc.importance)}</span>{!readOnly && <span className={access === 'none' ? 'ml-1 text-[10px] text-violet-500' : 'ml-1 text-[10px] text-sky-600'}>{PLAYER_ACCESS_LABEL[access]}</span>}{count > 0 && <span className="ml-1 text-sky-500">{count}</span>}</>}
        actions={readOnly ? undefined : <ExplorerAction label="+" title={`添加 ${node.npc.name} 到地图`} onClick={() => onPlace(node.npc)} />} />
    );
  })}</>;
}

export default function NpcPanel({ readOnly = false }: { readOnly?: boolean }) {
  const { scene, campaign } = useScene();
  const { performOps } = useBoardCommands();
  const { confirmAction } = useTabletopSettings();
  const npcs = campaign?.npcs ?? [];
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<NpcRecord | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = selectedId ? npcs.find(npc => npc.id === selectedId) ?? null : null;
  const filtered = useMemo(() => searchNpcs(npcs, query), [npcs, query]);
  const tree = useMemo(() => buildNpcTree(npcs), [npcs]);
  const tokenCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const token of scene?.tokens ?? []) {
      if (token.kind === 'npc' && token.entryId?.startsWith('npc:')) counts.set(token.entryId.slice(4), (counts.get(token.entryId.slice(4)) ?? 0) + 1);
    }
    return counts;
  }, [scene?.tokens]);

  if (editing) return <NpcEditor initial={editing} onClose={() => setEditing(null)} />;

  const place = async (npc: NpcRecord, supplied?: ResolvedNpcData) => {
    if (!scene) return;
    const data = supplied ?? await resolveNpcData(npc, npcs);
    performOps(`添加 ${npc.name} Token`, [{ op: 'addToken', token: createNpcToken(scene, npc, `npc-token-${crypto.randomUUID()}`, data) }]);
  };

  const pickUp = async (npc: NpcRecord, supplied?: ResolvedNpcData) => {
    const data = supplied ?? await resolveNpcData(npc, npcs);
    const maximum = data.hitPoints && data.hitPoints > 0 ? Math.round(data.hitPoints) : undefined;
    setPending({
      kind: 'npc', name: npc.name, entryId: npcEntryId(npc.id), avatar: data.avatar,
      color: npcTokenColor(npc.status), ...(maximum ? { hp: { current: maximum, max: maximum } } : {}),
    });
  };

  const remove = (npc: NpcRecord) => {
    if (!confirmAction(`删除“${npc.name}”的 NPC 档案？地图上已放置的 Token 会保留。`)) return;
    connection.sendOps([{ op: 'removeNpc', npcId: npc.id }]);
    setSelectedId(null);
  };

  const importMarkdown = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size <= 0 || file.size > MAX_NPC_MARKDOWN_BYTES) { setNotice('Markdown 文件需小于 512 KiB。'); return; }
    try {
      const parsed = parseNpcMarkdown(await file.text(), file.name);
      if (parsed.length === 0) { setNotice('没有识别到 NPC；请使用“# NPC 名称”或 front matter 的 name 字段。'); return; }
      const existingByName = new Map(npcs.map(npc => [normalizedName(npc.name), npc]));
      let available = Math.max(0, 250 - npcs.length);
      let created = 0;
      let updated = 0;
      const imported: NpcRecord[] = [];
      for (const candidate of parsed.slice(0, MAX_IMPORTED_NPCS)) {
        const existing = existingByName.get(normalizedName(candidate.name));
        if (!existing && available <= 0) continue;
        if (existing) updated += 1;
        else { created += 1; available -= 1; }
        const next = canonicalizeNpcRecord({ ...candidate, id: existing?.id ?? candidate.id, updatedAt: Date.now() });
        imported.push(next);
        existingByName.set(normalizedName(next.name), next);
      }
      sendBatches(imported.map(npc => ({ op: 'upsertNpc' as const, npc })));
      setNotice(`已归档 ${imported.length} 个 NPC（新增 ${created}，更新 ${updated}）。`);
    } catch (error) {
      setNotice(error instanceof Error ? `导入失败：${error.message}` : '导入失败');
    }
  };

  if (selected) {
    return <NpcDetail npc={selected} records={npcs} readOnly={readOnly} onBack={() => setSelectedId(null)} onEdit={() => setEditing(selected)}
      onPlace={data => { void place(selected, data); }} onPickUp={data => { void pickUp(selected, data); }} onDelete={() => remove(selected)} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-zinc-800 p-2">
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索 NPC、阵营、身份或地点…"
          className="w-full border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-zinc-100 outline-none focus:border-sky-500" />
        {!readOnly && <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={() => setEditing(emptyNpc())} className="border border-sky-800 bg-sky-950/40 px-2 py-1.5 text-xs text-sky-300 hover:bg-sky-900/40">新建 NPC</button>
          <button type="button" onClick={() => fileRef.current?.click()} className="border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700">导入 Markdown</button>
          <input ref={fileRef} type="file" accept=".md,.markdown,.mdown,text/markdown,text/plain" className="hidden" onChange={event => { void importMarkdown(event); }} />
        </div>}
        <p className="text-[10px] leading-relaxed text-zinc-600">统一按“阵营 → 人物”两级归档；每个人物只保留一份完整档案，并按重要程度排序。</p>
        {notice && <p role="status" className="text-[10px] leading-relaxed text-amber-300">{notice}</p>}
      </div>
      <div className="flex h-7 items-center border-b border-zinc-800 px-2 text-[11px] uppercase tracking-wide text-zinc-500">
        <span className="flex-1">NPC ({npcs.length})</span>
        {!query.trim() && <span>{tree.length} 个阵营</span>}
      </div>
      <div className="flex-1 overflow-y-auto">
        {query.trim() ? filtered.map(npc => (
          <div key={npc.id} className="flex items-center border-b border-zinc-800/60 hover:bg-zinc-800/70">
            <button type="button" onClick={() => setSelectedId(npc.id)} className="min-w-0 flex-1 px-3 py-2 text-left">
              <span className="block truncate text-zinc-100">{npc.name}</span>
              <span className="block truncate text-xs text-zinc-500">{[npcImportanceLabel(npc.importance), npc.role, npc.faction].filter(Boolean).join(' · ')}</span>
            </button>
            {!readOnly && <span className={`mr-1 text-[10px] ${(npc.playerAccess ?? 'none') === 'none' ? 'text-violet-500' : 'text-sky-600'}`}>{PLAYER_ACCESS_LABEL[npc.playerAccess ?? 'none']}</span>}
            <span className="mr-1 text-[10px] text-zinc-600">{STATUS_LABEL[npc.status]}</span>
            {!readOnly && <button type="button" onClick={() => { void place(npc); }} className="mr-2 border border-amber-900 bg-amber-950/40 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/40">+ 添加</button>}
          </div>
        )) : (
          <NpcTree nodes={tree} depth={0} closed={closed} onToggle={key => setClosed(current => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
          })} onOpen={npc => setSelectedId(npc.id)} onPlace={npc => { void place(npc); }} tokenCounts={tokenCounts} readOnly={readOnly} />
        )}
        {filtered.length === 0 && <div className="p-4 text-center text-xs text-zinc-500">{npcs.length === 0 ? '尚无 NPC 档案。' : '没有匹配的 NPC。'}</div>}
      </div>
    </div>
  );
}
