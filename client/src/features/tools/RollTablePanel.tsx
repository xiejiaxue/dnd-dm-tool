import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import type { JsonValue, RollTableDocument, RollTableResult } from '../../types';
import { useScene } from '../../ws';
import { useActionLog } from '../action-log/ActionLogContext';
import { secureRandom } from '../dice/formula';
import { useTabletopSettings } from '../settings/TabletopSettingsContext';

export default function RollTablePanel() {
  const { role } = useScene();
  const { record } = useActionLog();
  const canManage = role === 'dm';
  const [tables, setTables] = useState<RollTableDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setTables(await api.rollTables()); } catch (cause) { setError(message(cause)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const selected = tables.find(table => table.id === selectedId) ?? null;

  const create = async () => {
    if (!name.trim()) return;
    try {
      const table = await api.createToolDocument<RollTableDocument>('roll_table', { name: name.trim(), ownership: { default: 'observer', users: {} }, data: { replacement: true, results: [] } });
      setTables(current => [...current, table]); setSelectedId(table.id); setName('');
    } catch (cause) { setError(message(cause)); }
  };

  if (selected) return <RollTableEditor table={selected} canManage={canManage} onBack={() => setSelectedId(null)} onSaved={table => setTables(current => current.map(entry => entry.id === table.id ? table : entry))} onDraw={async result => { await record('roll', `${selected.name}：${result.text}`, { tableId: selected.id, resultId: result.id }); }} />;
  return <div className="flex h-full flex-col overflow-hidden"><div className="border-b border-zinc-800 p-2">{canManage && <div className="flex gap-1"><input value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void create(); }} placeholder="新随机表名称" className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 text-xs" /><button onClick={() => void create()} className="rounded bg-amber-500/15 px-2 text-xs text-amber-300">新建</button></div>}{error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}</div><div className="flex-1 overflow-y-auto">{tables.map(table => <button key={table.id} onClick={() => setSelectedId(table.id)} className="flex w-full items-center border-b border-zinc-800/70 px-3 py-2 text-left hover:bg-zinc-800"><span className="min-w-0 flex-1 truncate">{table.name}</span><span className="text-[10px] text-zinc-500">{table.results.length} 项</span></button>)}{tables.length === 0 && <p className="p-3 text-xs text-zinc-500">建立随机遭遇、战利品、名字或传闻表。</p>}</div></div>;
}

function RollTableEditor({ table, canManage, onBack, onSaved, onDraw }: { table: RollTableDocument; canManage: boolean; onBack(): void; onSaved(value: RollTableDocument): void; onDraw(value: RollTableResult): Promise<void> }) {
  const { confirmAction } = useTabletopSettings();
  const [draft, setDraft] = useState(table);
  const [resultText, setResultText] = useState('');
  const [weight, setWeight] = useState('1');
  const [drawn, setDrawn] = useState<RollTableResult | null>(null);
  const [error, setError] = useState('');
  const save = async (next = draft) => {
    try { const updated = await api.updateToolDocument<RollTableDocument>('roll_table', table.id, { name: next.name, folder: next.folder, locked: next.locked, data: tableData(next) }); setDraft(updated); onSaved(updated); return updated; }
    catch (cause) { setError(message(cause)); return null; }
  };
  const draw = async () => {
    const available = draft.results.filter(result => draft.replacement || !result.drawn);
    const result = drawWeighted(available);
    if (!result) { setError('随机表没有可抽取的结果'); return; }
    setDrawn(result); setError(''); await onDraw(result);
    if (!draft.replacement) { const next = { ...draft, results: draft.results.map(entry => entry.id === result.id ? { ...entry, drawn: true } : entry) }; setDraft(next); if (canManage) await save(next); }
  };
  const remove = async () => { if (!confirmAction(`删除随机表“${table.name}”？`)) return; try { await api.deleteToolDocument('roll_table', table.id); onBack(); } catch (cause) { setError(message(cause)); } };
  return <div className="flex h-full flex-col overflow-hidden"><header className="flex items-center gap-2 border-b border-zinc-800 p-2"><button onClick={onBack}>←</button><input value={draft.name} disabled={!canManage} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1" />{canManage && <button onClick={() => void save()} className="rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-300">保存</button>}</header><div className="flex-1 space-y-2 overflow-y-auto p-3">
    <button onClick={() => void draw()} className="w-full rounded bg-amber-500 py-2 font-semibold text-zinc-950">抽取结果</button>{drawn && <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-center text-lg text-amber-200">{drawn.text}</div>}
    {canManage && <div className="flex items-center gap-2 text-xs"><label className="flex items-center gap-1"><input type="checkbox" checked={draft.replacement} onChange={event => setDraft(current => ({ ...current, replacement: event.target.checked }))} />抽后放回</label>{!draft.replacement && <button onClick={() => setDraft(current => ({ ...current, results: current.results.map(result => ({ ...result, drawn: false })) }))} className="rounded bg-zinc-800 px-2 py-1 text-zinc-400">重置已抽取</button>}<input value={draft.folder} onChange={event => setDraft(current => ({ ...current, folder: event.target.value }))} placeholder="文件夹" className="ml-auto w-28 rounded bg-zinc-800 px-2 py-1" /></div>}
    {draft.results.map(result => <div key={result.id} className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${result.drawn ? 'bg-zinc-950/40 text-zinc-600 line-through' : 'bg-zinc-800/60'}`}><span className="min-w-0 flex-1">{result.text}</span><span className="text-zinc-500">权重 {result.weight}</span>{canManage && <button onClick={() => setDraft(current => ({ ...current, results: current.results.filter(entry => entry.id !== result.id) }))} title={`删除结果 ${result.text}`} aria-label={`删除随机表结果 ${result.text}`} className="text-zinc-600 hover:text-red-300">×</button>}</div>)}
    {canManage && <form onSubmit={event => { event.preventDefault(); const numeric = Number(weight); if (!resultText.trim() || !Number.isFinite(numeric) || numeric <= 0) return; setDraft(current => ({ ...current, results: [...current.results, { id: crypto.randomUUID(), text: resultText.trim(), weight: numeric, drawn: false }] })); setResultText(''); setWeight('1'); }} className="flex gap-1"><input value={resultText} onChange={event => setResultText(event.target.value)} placeholder="新结果" className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 text-xs" /><input type="number" min={1} value={weight} onChange={event => setWeight(event.target.value)} className="w-16 rounded bg-zinc-800 px-2 py-1 text-xs" /><button className="rounded bg-zinc-800 px-2 text-xs">添加</button></form>}
    {canManage && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.locked} onChange={event => setDraft(current => ({ ...current, locked: event.target.checked }))} />锁定随机表</label>}{canManage && !draft.locked && <button onClick={() => void remove()} className="w-full rounded border border-red-900/50 py-1.5 text-xs text-red-300">删除随机表</button>}{error && <p className="text-xs text-red-400">{error}</p>}
  </div></div>;
}

export function drawWeighted(results: RollTableResult[], random = secureRandom): RollTableResult | null {
  const total = results.reduce((sum, result) => sum + Math.max(0, result.weight), 0);
  if (total <= 0) return null;
  let value = random() * total;
  for (const result of results) { value -= Math.max(0, result.weight); if (value < 0) return result; }
  return results.at(-1) ?? null;
}

function tableData(table: RollTableDocument): Record<string, JsonValue> { return { replacement: table.replacement, results: table.results as unknown as JsonValue }; }
function message(cause: unknown): string { return cause instanceof Error ? cause.message : '随机表操作失败'; }
