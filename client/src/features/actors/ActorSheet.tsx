import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import {
  abilityModifier,
  actorSystemJson,
  effectiveActorSystem,
  normalizeActorSystem,
  type AbilityKey,
  type ActiveEffect,
  type ActorAction,
  type ActorDocument,
  type Dnd5eActorSystem,
  type ItemDocument,
  type OwnedItem,
} from '../../types';
import { useActionLog } from '../action-log/ActionLogContext';
import type { D20Mode, FormulaRollResult } from '../dice/formula';

type Tab = 'stats' | 'actions' | 'inventory' | 'effects' | 'bio' | 'token';
const ABILITIES: Array<{ key: AbilityKey; label: string }> = [
  { key: 'str', label: '力量' }, { key: 'dex', label: '敏捷' }, { key: 'con', label: '体质' },
  { key: 'int', label: '智力' }, { key: 'wis', label: '感知' }, { key: 'cha', label: '魅力' },
];

interface Props {
  actor: ActorDocument;
  itemLibrary: ItemDocument[];
  canEdit: boolean;
  onClose(): void;
  onSaved(actor: ActorDocument): void;
}

export default function ActorSheet({ actor, itemLibrary, canEdit, onClose, onSaved }: Props) {
  const { roll, applyAmount, selectedTokenIds } = useActionLog();
  const [tab, setTab] = useState<Tab>('stats');
  const [name, setName] = useState(actor.name);
  const [avatar, setAvatar] = useState(actor.avatar);
  const [system, setSystem] = useState<Dnd5eActorSystem>(() => normalizeActorSystem(actor.system));
  const [prototype, setPrototype] = useState(actor.prototypeToken);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [lastRoll, setLastRoll] = useState<{ action: ActorAction; result: FormulaRollResult } | null>(null);
  const [mode, setMode] = useState<D20Mode>('normal');
  const [newAction, setNewAction] = useState({ name: '', formula: '1d20', damageFormula: '', kind: 'attack' as ActorAction['kind'] });
  const [newEffect, setNewEffect] = useState({ name: '', path: 'armorClass', mode: 'add' as ActiveEffect['changes'][number]['mode'], value: '1', rounds: '' });
  const effective = useMemo(() => effectiveActorSystem(system), [system]);

  useEffect(() => {
    setName(actor.name); setAvatar(actor.avatar); setSystem(normalizeActorSystem(actor.system)); setPrototype(actor.prototypeToken);
  }, [actor.id]);

  const save = async () => {
    if (!canEdit || !name.trim()) return;
    setBusy(true);
    try {
      const updated = await api.updateActor(actor.id, { name: name.trim(), avatar, system: actorSystemJson(system), prototypeToken: prototype });
      onSaved(updated); setNotice('角色卡已保存'); setError('');
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };

  const runAction = async (action: ActorAction, formula = action.formula) => {
    try {
      const result = await roll({ label: `${name}：${action.name}`, formula, actorId: actor.id, mode });
      setLastRoll({ action, result }); setNotice(`${action.name}：${result.total}`); setError('');
    } catch (cause) { setError(message(cause)); }
  };

  const applyLast = async (type: 'damage' | 'healing') => {
    if (!lastRoll) return;
    const count = await applyAmount(type, Math.max(0, lastRoll.result.total), `${name}：${lastRoll.action.name}`);
    setNotice(count ? `已应用到 ${count} 个选中 Token` : '请先在地图选择带 HP 的 Token');
  };

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try { setAvatar((await api.uploadAsset(file, 'avatar')).url); setNotice('头像已上传，保存角色卡后生效'); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-900">
      <header className="border-b border-zinc-800 p-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} title="返回角色目录" className="rounded px-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">←</button>
          <div className="h-10 w-10 overflow-hidden rounded-full border border-zinc-700 bg-zinc-800">
            {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center">{name.slice(0, 1)}</span>}
          </div>
          <div className="min-w-0 flex-1">
            {canEdit ? <input value={name} onChange={event => setName(event.target.value)} className="w-full rounded bg-zinc-950 px-2 py-1 font-semibold" /> : <h2 className="truncate font-semibold">{name}</h2>}
            <p className="text-[10px] text-zinc-500">{actor.actorType} · AC {effective.armorClass} · HP {effective.hitPoints.current}/{effective.hitPoints.max}</p>
          </div>
          {canEdit && <button type="button" onClick={() => void save()} disabled={busy} className="rounded bg-amber-500/15 px-3 py-1.5 text-xs text-amber-300 disabled:opacity-40">{busy ? '保存中…' : '保存'}</button>}
        </div>
        <div className="mt-2 flex overflow-x-auto">
          {(['stats', 'actions', 'inventory', 'effects', 'bio', 'token'] as Tab[]).map(value => (
            <button key={value} type="button" onClick={() => setTab(value)} className={`shrink-0 border-b-2 px-2 py-1 text-[11px] ${tab === value ? 'border-amber-400 text-amber-300' : 'border-transparent text-zinc-500'}`}>{tabLabel(value)}</button>
          ))}
        </div>
        {(notice || error) && <p className={`mt-2 text-[11px] ${error ? 'text-red-400' : 'text-emerald-400'}`}>{error || notice}</p>}
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'stats' && <StatsTab system={system} effective={effective} canEdit={canEdit} onChange={setSystem} onRoll={(label, formula) => void runAction({ id: `ability-${label}`, name: label, kind: 'check', formula })} />}
        {tab === 'actions' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950/50 p-2 text-xs">
              <span className="text-zinc-500">d20 模式</span>
              <select value={mode} onChange={event => setMode(event.target.value as D20Mode)} className="rounded bg-zinc-800 px-2 py-1"><option value="normal">普通</option><option value="advantage">优势</option><option value="disadvantage">劣势</option></select>
              <span className="ml-auto text-zinc-500">地图已选 {selectedTokenIds.length}</span>
            </div>
            {[...system.actions, ...system.items.flatMap(item => item.actions.map(action => ({ ...action, name: `${item.name} · ${action.name}` })))].map(action => (
              <article key={action.id + action.name} className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
                <div className="flex items-center gap-2"><strong className="min-w-0 flex-1 truncate text-zinc-100">{action.name}</strong><code className="text-[10px] text-zinc-500">{action.formula}</code><button onClick={() => void runAction(action)} className="rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-300">掷骰</button></div>
                {action.damageFormula && <button type="button" onClick={() => void runAction(action, action.damageFormula)} className="mt-1 text-[11px] text-red-300 hover:underline">伤害 {action.damageFormula}</button>}
                {action.description && <p className="mt-1 text-xs leading-5 text-zinc-500">{action.description}</p>}
                {canEdit && system.actions.some(item => item.id === action.id) && <button type="button" onClick={() => setSystem(current => ({ ...current, actions: current.actions.filter(item => item.id !== action.id) }))} className="mt-1 text-[10px] text-zinc-600 hover:text-red-300">删除动作</button>}
              </article>
            ))}
            {lastRoll && (
              <div className="sticky bottom-0 rounded border border-amber-600/40 bg-zinc-900 p-2 shadow-xl">
                <div className="flex items-center gap-2"><span className="text-xs text-zinc-400">{lastRoll.action.name}</span><strong className="ml-auto text-2xl text-amber-300">{lastRoll.result.total}</strong></div>
                <div className="mt-1 flex gap-2"><button onClick={() => void applyLast('damage')} className="flex-1 rounded bg-red-500/15 py-1.5 text-xs text-red-300">对选中目标造成伤害</button><button onClick={() => void applyLast('healing')} className="flex-1 rounded bg-emerald-500/15 py-1.5 text-xs text-emerald-300">对选中目标治疗</button></div>
              </div>
            )}
            {canEdit && (
              <form onSubmit={event => { event.preventDefault(); if (!newAction.name.trim()) return; setSystem(current => ({ ...current, actions: [...current.actions, { id: crypto.randomUUID(), name: newAction.name.trim(), kind: newAction.kind, formula: newAction.formula.trim(), ...(newAction.damageFormula.trim() ? { damageFormula: newAction.damageFormula.trim() } : {}) }] })); setNewAction({ name: '', formula: '1d20', damageFormula: '', kind: 'attack' }); }} className="grid grid-cols-2 gap-2 rounded border border-zinc-800 p-2">
                <input value={newAction.name} onChange={event => setNewAction(current => ({ ...current, name: event.target.value }))} placeholder="动作名称" className="rounded bg-zinc-800 px-2 py-1 text-xs" />
                <select value={newAction.kind} onChange={event => setNewAction(current => ({ ...current, kind: event.target.value as ActorAction['kind'] }))} className="rounded bg-zinc-800 px-2 py-1 text-xs"><option value="attack">攻击</option><option value="check">检定</option><option value="save">豁免</option><option value="damage">伤害</option><option value="healing">治疗</option><option value="utility">其他</option></select>
                <input value={newAction.formula} onChange={event => setNewAction(current => ({ ...current, formula: event.target.value }))} placeholder="检定公式 1d20+5" className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs" />
                <input value={newAction.damageFormula} onChange={event => setNewAction(current => ({ ...current, damageFormula: event.target.value }))} placeholder="伤害公式 1d8+3" className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs" />
                <button className="col-span-2 rounded bg-zinc-800 py-1.5 text-xs text-zinc-300">添加动作</button>
              </form>
            )}
          </div>
        )}
        {tab === 'inventory' && <InventoryTab system={system} library={itemLibrary} canEdit={canEdit} onChange={setSystem} />}
        {tab === 'effects' && (
          <div className="space-y-2">
            {system.effects.map(effect => <EffectRow key={effect.id} effect={effect} canEdit={canEdit} onChange={next => setSystem(current => ({ ...current, effects: current.effects.map(item => item.id === effect.id ? next : item) }))} onDelete={() => setSystem(current => ({ ...current, effects: current.effects.filter(item => item.id !== effect.id) }))} />)}
            {system.effects.length === 0 && <p className="text-xs text-zinc-500">没有角色级效果。装备中的效果会在装备后自动叠加。</p>}
            {canEdit && <form onSubmit={event => { event.preventDefault(); const value = Number(newEffect.value); const rounds = newEffect.rounds.trim() ? Number(newEffect.rounds) : null; if (!newEffect.name.trim() || !Number.isFinite(value) || (rounds !== null && !Number.isFinite(rounds))) return; setSystem(current => ({ ...current, effects: [...current.effects, { id: crypto.randomUUID(), name: newEffect.name.trim(), enabled: true, remainingRounds: rounds, changes: [{ path: newEffect.path.trim(), mode: newEffect.mode, value }] }] })); setNewEffect({ name: '', path: 'armorClass', mode: 'add', value: '1', rounds: '' }); }} className="space-y-2 rounded border border-zinc-800 p-2">
              <input value={newEffect.name} onChange={event => setNewEffect(current => ({ ...current, name: event.target.value }))} placeholder="效果名称" className="w-full rounded bg-zinc-800 px-2 py-1 text-xs" />
              <div className="grid grid-cols-2 gap-2"><input value={newEffect.path} onChange={event => setNewEffect(current => ({ ...current, path: event.target.value }))} placeholder="数据路径，如 armorClass" className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs" /><select value={newEffect.mode} onChange={event => setNewEffect(current => ({ ...current, mode: event.target.value as ActiveEffect['changes'][number]['mode'] }))} className="rounded bg-zinc-800 px-2 py-1 text-xs"><option value="add">加值</option><option value="multiply">乘算</option><option value="override">覆盖</option><option value="upgrade">至少</option><option value="downgrade">至多</option></select><input value={newEffect.value} onChange={event => setNewEffect(current => ({ ...current, value: event.target.value }))} placeholder="数值" className="rounded bg-zinc-800 px-2 py-1 text-xs" /><input value={newEffect.rounds} onChange={event => setNewEffect(current => ({ ...current, rounds: event.target.value }))} placeholder="持续轮数，空为永久" className="rounded bg-zinc-800 px-2 py-1 text-xs" /></div>
              <button className="w-full rounded bg-violet-500/15 py-1.5 text-xs text-violet-300">添加效果</button>
            </form>}
          </div>
        )}
        {tab === 'bio' && <div className="space-y-3"><TextArea label="人物背景与身份" value={system.biography} canEdit={canEdit} onChange={value => setSystem(current => ({ ...current, biography: value }))} /><TextArea label="主持人/角色备注" value={system.notes} canEdit={canEdit} onChange={value => setSystem(current => ({ ...current, notes: value }))} /></div>}
        {tab === 'token' && (
          <div className="space-y-3 text-xs">
            <label className="block"><span className="mb-1 block text-zinc-500">角色头像 URL</span><input value={avatar} disabled={!canEdit} onChange={event => setAvatar(event.target.value)} className="w-full rounded bg-zinc-800 px-2 py-1.5" /></label>
            {canEdit && <label className="block cursor-pointer rounded border border-dashed border-zinc-700 p-3 text-center text-zinc-400 hover:border-amber-600">上传头像<input type="file" accept="image/*" className="hidden" onChange={event => { void uploadAvatar(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>}
            <label className="block"><span className="mb-1 block text-zinc-500">Token 名称</span><input value={prototype.name} disabled={!canEdit} onChange={event => setPrototype(current => ({ ...current, name: event.target.value }))} className="w-full rounded bg-zinc-800 px-2 py-1.5" /></label>
            <div className="grid grid-cols-2 gap-2"><label><span className="mb-1 block text-zinc-500">颜色</span><input type="color" value={prototype.color} disabled={!canEdit} onChange={event => setPrototype(current => ({ ...current, color: event.target.value }))} className="h-9 w-full rounded bg-zinc-800" /></label><label><span className="mb-1 block text-zinc-500">尺寸</span><input type="number" min={25} max={1000} value={prototype.size} disabled={!canEdit} onChange={event => setPrototype(current => ({ ...current, size: Number(event.target.value) }))} className="w-full rounded bg-zinc-800 px-2 py-1.5" /></label></div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={prototype.hidden} disabled={!canEdit} onChange={event => setPrototype(current => ({ ...current, hidden: event.target.checked }))} />新放置 Token 默认隐藏</label>
            <label className="block"><span className="mb-1 block text-zinc-500">玩家 HP 可见性</span><select value={prototype.hpVisibility} disabled={!canEdit} onChange={event => setPrototype(current => ({ ...current, hpVisibility: event.target.value as typeof current.hpVisibility }))} className="w-full rounded bg-zinc-800 px-2 py-1.5"><option value="none">隐藏</option><option value="bar">仅生命条</option><option value="value">显示数值</option></select></label>
          </div>
        )}
      </div>
    </div>
  );
}

function StatsTab({ system, effective, canEdit, onChange, onRoll }: { system: Dnd5eActorSystem; effective: Dnd5eActorSystem; canEdit: boolean; onChange(value: Dnd5eActorSystem): void; onRoll(label: string, formula: string): void }) {
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2"><NumberField label="等级" value={system.level} disabled={!canEdit} onChange={value => onChange({ ...system, level: value })} /><NumberField label="熟练加值" value={system.proficiency} disabled={!canEdit} onChange={value => onChange({ ...system, proficiency: value })} /><NumberField label={`护甲等级${effective.armorClass !== system.armorClass ? `（效果后 ${effective.armorClass}）` : ''}`} value={system.armorClass} disabled={!canEdit} onChange={value => onChange({ ...system, armorClass: value })} /><NumberField label="速度" value={system.speed} disabled={!canEdit} onChange={value => onChange({ ...system, speed: value })} /></div>
    <fieldset className="grid grid-cols-3 gap-2"><legend className="col-span-3 mb-1 text-xs text-zinc-500">生命值</legend><NumberField label="当前" value={system.hitPoints.current} disabled={!canEdit} onChange={value => onChange({ ...system, hitPoints: { ...system.hitPoints, current: value } })} /><NumberField label="最大" value={system.hitPoints.max} disabled={!canEdit} onChange={value => onChange({ ...system, hitPoints: { ...system.hitPoints, max: value } })} /><NumberField label="临时" value={system.hitPoints.temporary} disabled={!canEdit} onChange={value => onChange({ ...system, hitPoints: { ...system.hitPoints, temporary: value } })} /></fieldset>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{ABILITIES.map(({ key, label }) => { const score = system.abilities[key]; const modifier = abilityModifier(effective.abilities[key]); return <div key={key} className="rounded border border-zinc-800 bg-zinc-950/40 p-2 text-center"><span className="text-[10px] text-zinc-500">{label}</span>{canEdit ? <input type="number" value={score} onChange={event => onChange({ ...system, abilities: { ...system.abilities, [key]: Number(event.target.value) } })} className="mx-auto block w-16 bg-transparent text-center text-xl font-semibold outline-none" /> : <strong className="block text-xl">{score}</strong>}<button type="button" onClick={() => onRoll(`${label}检定`, `1d20${modifier >= 0 ? '+' : ''}${modifier}`)} className="mt-1 rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-amber-300">{modifier >= 0 ? '+' : ''}{modifier} 掷骰</button></div>; })}</div>
  </div>;
}

function InventoryTab({ system, library, canEdit, onChange }: { system: Dnd5eActorSystem; library: ItemDocument[]; canEdit: boolean; onChange(value: Dnd5eActorSystem): void }) {
  const add = (source: ItemDocument) => {
    const item: OwnedItem = { id: crypto.randomUUID(), sourceItemId: source.id, name: source.name, itemType: source.itemType, image: source.image, quantity: 1, equipped: false, description: source.description, system: structuredClone(source.system), actions: structuredClone(source.actions), effects: structuredClone(source.effects) };
    onChange({ ...system, items: [...system.items, item] });
  };
  return <div className="space-y-2">
    {system.items.map(item => <article key={item.id} className="rounded border border-zinc-800 p-2"><div className="flex items-center gap-2">{item.image && <img src={item.image} alt="" className="h-8 w-8 rounded object-cover" />}<div className="min-w-0 flex-1"><strong className="block truncate text-zinc-100">{item.name}</strong><span className="text-[10px] text-zinc-500">{item.itemType} · 数量 {item.quantity}</span></div>{canEdit && <><button onClick={() => onChange({ ...system, items: system.items.map(current => current.id === item.id ? { ...current, equipped: !current.equipped } : current) })} className={`rounded px-2 py-1 text-[10px] ${item.equipped ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-zinc-500'}`}>{item.equipped ? '已装备' : '未装备'}</button><button onClick={() => onChange({ ...system, items: system.items.filter(current => current.id !== item.id) })} title={`从角色物品栏移除 ${item.name}`} aria-label={`移除物品 ${item.name}`} className="text-zinc-600 hover:text-red-300">×</button></>}</div>{item.description && <p className="mt-1 line-clamp-3 text-xs leading-5 text-zinc-500">{item.description}</p>}</article>)}
    {system.items.length === 0 && <p className="text-xs text-zinc-500">角色还没有物品。</p>}
    {canEdit && <div className="rounded border border-zinc-800 p-2"><h4 className="mb-2 text-xs text-zinc-400">从物品库添加独立副本</h4><div className="max-h-48 overflow-y-auto">{library.map(item => <button key={item.id} onClick={() => add(item)} className="flex w-full items-center border-b border-zinc-800/50 px-2 py-1.5 text-left text-xs hover:bg-zinc-800"><span className="min-w-0 flex-1 truncate">{item.name}</span><span className="text-zinc-600">＋</span></button>)}{library.length === 0 && <p className="text-[11px] text-zinc-600">先在“物品”栏目建立武器、法术或装备。</p>}</div></div>}
  </div>;
}

function EffectRow({ effect, canEdit, onChange, onDelete }: { effect: ActiveEffect; canEdit: boolean; onChange(value: ActiveEffect): void; onDelete(): void }) {
  return <article className={`rounded border p-2 ${effect.enabled ? 'border-violet-800/60 bg-violet-950/15' : 'border-zinc-800 opacity-60'}`}><div className="flex items-center gap-2"><strong className="min-w-0 flex-1 truncate">{effect.name}</strong><span className="text-[10px] text-zinc-500">{effect.remainingRounds === null ? '永久' : `${effect.remainingRounds} 轮`}</span>{canEdit && <button onClick={() => onChange({ ...effect, enabled: !effect.enabled })} className="rounded bg-zinc-800 px-2 py-1 text-[10px]">{effect.enabled ? '停用' : '启用'}</button>}{canEdit && <button onClick={onDelete} title={`删除效果 ${effect.name}`} aria-label={`删除效果 ${effect.name}`} className="text-zinc-600 hover:text-red-300">×</button>}</div><div className="mt-1 font-mono text-[10px] text-zinc-500">{effect.changes.map(change => `${change.path} ${change.mode} ${change.value}`).join('；')}</div></article>;
}

function NumberField({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange(value: number): void }) {
  return <label className="block text-[10px] text-zinc-500"><span className="mb-1 block">{label}</span><input type="number" value={value} disabled={disabled} onChange={event => onChange(Number(event.target.value))} className="w-full rounded bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 disabled:opacity-70" /></label>;
}

function TextArea({ label, value, canEdit, onChange }: { label: string; value: string; canEdit: boolean; onChange(value: string): void }) {
  return <label className="block text-xs text-zinc-500"><span className="mb-1 block">{label}</span>{canEdit ? <textarea value={value} onChange={event => onChange(event.target.value)} className="min-h-44 w-full rounded bg-zinc-950 p-3 leading-6 text-zinc-200 outline-none ring-1 ring-zinc-800 focus:ring-amber-600" /> : <div className="whitespace-pre-wrap rounded bg-zinc-950/50 p-3 leading-6 text-zinc-200">{value || '暂无内容'}</div>}</label>;
}

function tabLabel(tab: Tab): string { return ({ stats: '属性', actions: '动作与掷骰', inventory: '物品/法术', effects: '效果', bio: '背景', token: 'Token' } as Record<Tab, string>)[tab]; }
function message(cause: unknown): string { return cause instanceof Error ? cause.message : '操作失败'; }
