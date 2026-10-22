import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import type { EncounterPresetCombatant, EncounterPresetDocument, JsonValue, Op } from '../../types';
import { connection, useScene } from '../../ws';
import { useActionLog } from '../action-log/ActionLogContext';
import { secureRandom } from '../dice/formula';
import { useTabletopSettings } from '../settings/TabletopSettingsContext';

export default function EncounterPresetPanel() {
  const { role, scene, encounter } = useScene();
  const { selectedTokenIds, record } = useActionLog();
  const canManage = role === 'dm';
  const [presets, setPresets] = useState<EncounterPresetDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setPresets(await api.encounterPresets()); } catch (cause) { setError(message(cause)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const selected = presets.find(preset => preset.id === selectedId) ?? null;
  const selectedTokens = useMemo(() => (scene?.tokens ?? []).filter(token => selectedTokenIds.includes(token.id)), [scene?.tokens, selectedTokenIds]);
  const create = async () => {
    if (!name.trim()) return;
    const combatants = groupTokens(selectedTokens);
    try { const created = await api.createToolDocument<EncounterPresetDocument>('encounter_preset', { name: name.trim(), ownership: { default: 'none', users: {} }, data: { combatants: combatants as unknown as JsonValue, notes: '' } }); setPresets(current => [...current, created]); setSelectedId(created.id); setName(''); } catch (cause) { setError(message(cause)); }
  };
  const activate = async (preset: EncounterPresetDocument) => {
    if (!scene) return;
    const occupied = new Set(encounter?.status === 'ended' ? [] : (encounter?.combatants ?? []).flatMap(entry => entry.tokenId ? [entry.tokenId] : []));
    const remaining = [...scene.tokens];
    const operations: Op[] = [];
    if (!encounter || encounter.status === 'ended') operations.push({ op: 'createEncounter' });
    for (const combatant of preset.combatants) {
      const matches = remaining.filter(token => !occupied.has(token.id) && (token.actorId === combatant.sourceId || token.entryId === combatant.sourceId || token.name === combatant.name)).slice(0, combatant.count);
      matches.forEach(token => { occupied.add(token.id); operations.push({ op: 'addToInitiative', name: token.number ? `${token.name} #${token.number}` : token.name, value: d20() + combatant.initiativeModifier, source: 'dm', tokenId: token.id }); });
      for (let index = matches.length; index < combatant.count; index += 1) operations.push({ op: 'addToInitiative', name: combatant.count > 1 ? `${combatant.name} #${index + 1}` : combatant.name, value: d20() + combatant.initiativeModifier, source: 'dm', tokenId: null });
    }
    connection.sendOps(operations);
    await record('encounter', `载入 Encounter 预设：${preset.name}`, { presetId: preset.id, combatantCount: preset.combatants.reduce((sum, entry) => sum + entry.count, 0) });
  };
  if (selected) return <PresetEditor preset={selected} canManage={canManage} selectedCombatants={groupTokens(selectedTokens)} onBack={() => setSelectedId(null)} onSaved={updated => setPresets(current => current.map(value => value.id === updated.id ? updated : value))} onActivate={() => void activate(selected)} />;
  return <div className="flex h-full flex-col"><div className="space-y-1 border-b border-zinc-800 p-2">{canManage && <div className="flex gap-1"><input value={name} onChange={event => setName(event.target.value)} placeholder="新 Encounter 预设" className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 text-xs" /><button onClick={() => void create()} className="rounded bg-amber-500/15 px-2 text-xs text-amber-300">{selectedTokens.length ? `保存所选 (${selectedTokens.length})` : '新建'}</button></div>}<p className="text-[10px] text-zinc-600">可先在地图框选 Token，再建立预设；载入时优先绑定场景中同源 Token。</p>{error && <p className="text-xs text-red-400">{error}</p>}</div><div className="flex-1 overflow-y-auto">{presets.map(preset => <div key={preset.id} className="flex items-center border-b border-zinc-800/70"><button onClick={() => setSelectedId(preset.id)} className="min-w-0 flex-1 px-3 py-2 text-left hover:bg-zinc-800"><span className="block truncate">{preset.name}</span><span className="text-[10px] text-zinc-500">{preset.combatants.reduce((sum, entry) => sum + entry.count, 0)} 个参战者</span></button>{canManage && <button onClick={() => void activate(preset)} className="mr-2 rounded bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">载入</button>}</div>)}{presets.length === 0 && <p className="p-3 text-xs text-zinc-500">尚无预设。适合保存常用遭遇组合和先攻调整值。</p>}</div></div>;
}

function PresetEditor({ preset, canManage, selectedCombatants, onBack, onSaved, onActivate }: { preset: EncounterPresetDocument; canManage: boolean; selectedCombatants: EncounterPresetCombatant[]; onBack(): void; onSaved(value: EncounterPresetDocument): void; onActivate(): void }) {
  const { confirmAction } = useTabletopSettings();
  const [draft, setDraft] = useState(preset);
  const [manual, setManual] = useState({ name: '', count: '1', modifier: '0' });
  const [error, setError] = useState('');
  const save = async () => { try { const updated = await api.updateToolDocument<EncounterPresetDocument>('encounter_preset', preset.id, { name: draft.name, folder: draft.folder, locked: draft.locked, data: { combatants: draft.combatants as unknown as JsonValue, notes: draft.notes } }); setDraft(updated); onSaved(updated); } catch (cause) { setError(message(cause)); } };
  const remove = async () => { if (!confirmAction(`删除预设“${preset.name}”？`)) return; try { await api.deleteToolDocument('encounter_preset', preset.id); onBack(); } catch (cause) { setError(message(cause)); } };
  return <div className="flex h-full flex-col overflow-hidden"><header className="flex items-center gap-2 border-b border-zinc-800 p-2"><button onClick={onBack}>←</button><input value={draft.name} disabled={!canManage} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1" />{canManage && <button onClick={onActivate} className="rounded bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">载入</button>}{canManage && <button onClick={() => void save()} className="rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-300">保存</button>}</header><div className="flex-1 space-y-2 overflow-y-auto p-3">
    {draft.combatants.map(combatant => <div key={combatant.id} className="grid grid-cols-[1fr_3rem_4rem_auto] items-center gap-1 rounded bg-zinc-800/60 px-2 py-1.5 text-xs"><span className="truncate">{combatant.name}</span><input type="number" min={1} value={combatant.count} disabled={!canManage} onChange={event => setDraft(current => ({ ...current, combatants: current.combatants.map(entry => entry.id === combatant.id ? { ...entry, count: Math.max(1, Number(event.target.value)) } : entry) }))} className="rounded bg-zinc-950 px-1 text-center" /><input type="number" value={combatant.initiativeModifier} disabled={!canManage} onChange={event => setDraft(current => ({ ...current, combatants: current.combatants.map(entry => entry.id === combatant.id ? { ...entry, initiativeModifier: Number(event.target.value) } : entry) }))} className="rounded bg-zinc-950 px-1 text-center" title="先攻调整值" />{canManage && <button onClick={() => setDraft(current => ({ ...current, combatants: current.combatants.filter(entry => entry.id !== combatant.id) }))} title={`从预设移除 ${combatant.name}`} aria-label={`移除参战者 ${combatant.name}`} className="text-zinc-600 hover:text-red-300">×</button>}</div>)}
    {canManage && selectedCombatants.length > 0 && <button onClick={() => setDraft(current => ({ ...current, combatants: mergeCombatants(current.combatants, selectedCombatants) }))} className="w-full rounded bg-sky-500/15 py-1.5 text-xs text-sky-300">加入当前地图所选 Token</button>}
    {canManage && <form onSubmit={event => { event.preventDefault(); const count = Number(manual.count), modifier = Number(manual.modifier); if (!manual.name.trim() || !Number.isFinite(count) || !Number.isFinite(modifier)) return; setDraft(current => ({ ...current, combatants: [...current.combatants, { id: crypto.randomUUID(), name: manual.name.trim(), sourceType: 'manual', sourceId: null, count: Math.max(1, count), initiativeModifier: modifier, hidden: false }] })); setManual({ name: '', count: '1', modifier: '0' }); }} className="grid grid-cols-[1fr_3rem_4rem] gap-1"><input value={manual.name} onChange={event => setManual(current => ({ ...current, name: event.target.value }))} placeholder="手动参战者" className="rounded bg-zinc-800 px-2 py-1 text-xs" /><input type="number" min={1} value={manual.count} onChange={event => setManual(current => ({ ...current, count: event.target.value }))} className="rounded bg-zinc-800 px-1 text-xs" title="数量" /><input type="number" value={manual.modifier} onChange={event => setManual(current => ({ ...current, modifier: event.target.value }))} className="rounded bg-zinc-800 px-1 text-xs" title="先攻调整" /><button className="col-span-3 rounded bg-zinc-800 py-1 text-xs">添加</button></form>}
    <textarea value={draft.notes} disabled={!canManage} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} placeholder="遭遇说明、战术或触发条件" className="min-h-28 w-full rounded bg-zinc-950 p-2 text-xs ring-1 ring-zinc-800" />{canManage && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.locked} onChange={event => setDraft(current => ({ ...current, locked: event.target.checked }))} />锁定预设</label>}{canManage && !draft.locked && <button onClick={() => void remove()} className="w-full rounded border border-red-900/50 py-1.5 text-xs text-red-300">删除预设</button>}{error && <p className="text-xs text-red-400">{error}</p>}
  </div></div>;
}

function groupTokens(tokens: Array<{ name: string; actorId?: string | null; entryId: string | null }>): EncounterPresetCombatant[] {
  const groups = new Map<string, EncounterPresetCombatant>();
  for (const token of tokens) { const sourceId = token.actorId ?? token.entryId; const key = `${sourceId ?? ''}:${token.name}`; const current = groups.get(key); if (current) current.count += 1; else groups.set(key, { id: crypto.randomUUID(), name: token.name, sourceType: token.actorId ? 'actor' : token.entryId ? 'compendium' : 'manual', sourceId: sourceId ?? null, count: 1, initiativeModifier: 0, hidden: false }); }
  return [...groups.values()];
}
function mergeCombatants(current: EncounterPresetCombatant[], incoming: EncounterPresetCombatant[]): EncounterPresetCombatant[] { const next = current.map(value => ({ ...value })); for (const value of incoming) { const match = next.find(entry => entry.sourceId === value.sourceId && entry.name === value.name); if (match) match.count += value.count; else next.push(value); } return next; }
function d20(): number { return Math.floor(secureRandom() * 20) + 1; }
function message(cause: unknown): string { return cause instanceof Error ? cause.message : 'Encounter 预设操作失败'; }
