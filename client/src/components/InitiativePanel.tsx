import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { InitiativeEntry } from '../types';
import { connection, getMySessionId, useScene } from '../ws';
import { useTabletopSettings } from '../features/settings/TabletopSettingsContext';

interface Props {
  selectedTokenIds?: readonly string[];
  onClearSelected?: () => void;
}

export default function InitiativePanel({ selectedTokenIds = [], onClearSelected }: Props) {
  const { scene, role, encounter } = useScene();
  const [value, setValue] = useState('');
  const [dmName, setDmName] = useState('');
  const [dmValue, setDmValue] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [message, setMessage] = useState('');
  const { confirmAction } = useTabletopSettings();
  const entries = encounter?.combatants ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeId = encounter?.turn != null ? entries[encounter.turn]?.id ?? null : null;
  const activeEntry = encounter?.turn != null ? entries[encounter.turn] ?? null : null;
  const mySessionId = getMySessionId();
  const myToken = scene?.players.find(player => player.sessionId === mySessionId) ?? null;
  const isDm = role === 'dm';
  const isSetup = encounter?.status === 'setup';
  const isActive = encounter?.status === 'active';
  const canNavigate = entries.some(entry => !entry.defeated);
  const playerInitiative = Number(value);
  const dmInitiative = Number(dmValue);
  const selectedTokens = useMemo(() => {
    const tokens = [...(scene?.tokens ?? []), ...(scene?.players ?? [])];
    return selectedTokenIds.flatMap(id => {
      const token = tokens.find(candidate => candidate.id === id);
      return token ? [token] : [];
    });
  }, [scene?.tokens, scene?.players, selectedTokenIds]);
  const selectedAutomaticTokens = useMemo(
    () => selectedTokens.filter(token => token.kind === 'monster' || token.kind === 'npc'),
    [selectedTokens],
  );

  useEffect(() => {
    if (!activeId || !scrollRef.current) return;
    const element = scrollRef.current.querySelector<HTMLElement>(`[data-ini="${activeId}"]`);
    if (!element) return;
    const container = scrollRef.current;
    const targetLeft = element.offsetLeft - container.clientWidth / 2 + element.clientWidth / 2;
    container.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
  }, [activeId]);

  const submit = () => {
    const initiative = Number(value);
    if (!Number.isFinite(initiative)) return;
    connection.sendOps([{
      op: 'submitInitiative', name: myToken?.name ?? '玩家', value: initiative,
      tokenId: myToken?.id ?? null, sessionId: mySessionId,
    }]);
    setValue('');
  };

  const addDm = () => {
    const initiative = Number(dmValue);
    if (!Number.isFinite(initiative)) return;
    if (selectedTokens.length) {
      connection.sendOps(selectedTokens.map(token => ({
        op: 'addToInitiative' as const,
        name: token.number != null ? `${token.name} #${token.number}` : token.name,
        value: initiative,
        source: 'dm' as const,
        tokenId: token.id,
      })));
      onClearSelected?.();
    } else if (dmName.trim()) {
      connection.sendOps([{ op: 'addToInitiative', name: dmName.trim(), value: initiative, source: 'dm', tokenId: null }]);
    } else return;
    setDmName('');
    setDmValue('');
  };

  const rollSelected = async () => {
    if (rolling || selectedAutomaticTokens.length === 0) return;
    setRolling(true);
    try {
      const result = await api.rollInitiative(selectedAutomaticTokens.map(token => token.id));
      setMessage(result.rolls.length ? `已将 ${result.rolls.length} 个所选单位加入战斗并自动先攻` : '没有可自动掷骰的所选单位');
      if (result.rolls.length) onClearSelected?.();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '自动先攻失败');
    } finally {
      setRolling(false);
    }
  };

  return (
    <section className="encounter-section shrink-0 border-b border-zinc-700/60 bg-zinc-900 text-sm">
      <div className="flex min-h-14 items-center gap-2 px-2">
        <button type="button" onClick={() => setExpanded(open => !open)}
          className="min-w-[7rem] shrink-0 rounded px-1 py-1 text-left hover:bg-zinc-800" title="展开战斗工作台">
          <div className="font-medium text-zinc-300">战斗追踪 <span className="text-zinc-600">{expanded ? '▴' : '▾'}</span></div>
          <div className="text-[10px] text-zinc-500">
            {!encounter ? '尚未创建遭遇' : encounter.status === 'setup' ? '准备阶段' : encounter.status === 'ended' ? '战斗已结束' : `第 ${encounter.round} 轮 · ${activeEntry?.name ?? '等待行动'}`}
          </div>
        </button>

        <div ref={scrollRef} className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-x-auto py-2">
          {entries.map((entry, index) => {
            const active = isActive && encounter?.turn === index;
            const linkedToken = scene?.tokens.find(token => token.id === entry.tokenId);
            const hidden = entry.hidden ?? linkedToken?.hidden ?? false;
            return (
              <div key={entry.id} data-ini={entry.id}
                className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-1 ${active ? 'initiative-active bg-emerald-700/60 text-white ring-1 ring-emerald-400' : entry.defeated ? 'bg-red-950/30 text-zinc-500 line-through' : hidden ? 'border border-dashed border-violet-700/70 bg-violet-950/20 text-zinc-400' : 'bg-zinc-800 text-zinc-300'}`}>
                <span>{entry.name}</span>
                <span className={active ? 'text-emerald-200' : 'text-amber-400'}>{entry.value}</span>
                {entry.group && <span className="max-w-20 truncate text-[10px] text-sky-300" title={`分组：${entry.group}`}>[{entry.group}]</span>}
                {entry.turnState === 'ready' && <span className="text-[10px] text-blue-300">准备</span>}
                {entry.turnState === 'delayed' && <span className="text-[10px] text-orange-300">延迟</span>}
                {entry.defeated && <span className="text-[10px] text-red-400 no-underline">战败</span>}
              </div>
            );
          })}
          {encounter && entries.length === 0 && encounter.status !== 'ended' && <span className="text-xs text-zinc-600">选择地图 Token 后加入，或展开工作台添加</span>}
        </div>

        {isDm && !encounter && (
          <button onClick={() => connection.sendOps([{ op: 'createEncounter' }])}
            className="shrink-0 rounded bg-emerald-600/20 px-2 py-1 text-emerald-400 hover:bg-emerald-600/30">新建遭遇</button>
        )}
        {isDm && encounter?.status === 'ended' && (
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => connection.sendOps([{ op: 'duplicateEncounter' }])}
              title="保留上一场参战者并重置回合、战败与行动状态"
              className="rounded bg-amber-600/20 px-2 py-1 text-amber-300 hover:bg-amber-600/30">复制并重置</button>
            <button onClick={() => connection.sendOps([{ op: 'createEncounter' }])}
              title="创建一场没有参战者的全新遭遇"
              className="rounded bg-emerald-600/20 px-2 py-1 text-emerald-400 hover:bg-emerald-600/30">空白遭遇</button>
          </div>
        )}
        {isDm && isSetup && (
          <button onClick={() => connection.sendOps([{ op: 'startEncounter' }])} disabled={!entries.some(entry => !entry.defeated)}
            className="shrink-0 rounded bg-amber-600/20 px-2 py-1 text-amber-400 hover:bg-amber-600/30 disabled:opacity-40">开始战斗</button>
        )}
        {isDm && isActive && (
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => connection.sendOps([{ op: 'previousRound' }])} disabled={!canNavigate}
              title="上一轮" aria-label="上一轮" className="h-7 w-7 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-35">«</button>
            <button onClick={() => connection.sendOps([{ op: 'previousTurn' }])} disabled={!canNavigate}
              title="上一行动" aria-label="上一行动" className="h-7 w-7 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-35">‹</button>
            <button onClick={() => connection.sendOps([{ op: 'nextTurn' }])} disabled={!canNavigate} title="跳过战败者并进入下一行动"
              className="h-7 rounded bg-amber-600/20 px-2 text-amber-400 hover:bg-amber-600/30 disabled:cursor-not-allowed disabled:opacity-35">下一行动</button>
            <button onClick={() => connection.sendOps([{ op: 'nextRound' }])} disabled={!canNavigate}
              title="下一轮，并递减有限轮数状态" aria-label="下一轮" className="h-7 w-7 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-35">»</button>
            <button onClick={() => { if (confirmAction('确认结束当前战斗？地图 Token 会保留。')) connection.sendOps([{ op: 'endEncounter' }]); }}
              className="h-7 rounded bg-red-600/15 px-2 text-red-400 hover:bg-red-600/25">结束</button>
          </div>
        )}
        {role === 'player' && isActive && activeEntry?.sessionId === mySessionId && (
          <button onClick={() => connection.sendOps([{ op: 'endMyTurn' }])}
            className="shrink-0 rounded bg-emerald-500 px-3 py-1.5 font-medium text-zinc-950 hover:bg-emerald-400">结束我的行动</button>
        )}
        {role === 'player' && (!encounter || isSetup) && (
          <div className="flex shrink-0 items-center gap-1">
            <input value={value} onChange={event => setValue(event.target.value)} placeholder="先攻值" className="w-16 rounded bg-zinc-800 px-2 py-0.5 text-center" />
            <button onClick={submit} disabled={!myToken || !value.trim() || !Number.isFinite(playerInitiative)} className="rounded bg-emerald-600/20 px-2 py-0.5 text-emerald-400 disabled:opacity-40">提交</button>
          </div>
        )}
      </div>

      {expanded && isDm && encounter && encounter.status !== 'ended' && (
        <div className="border-t border-zinc-800 bg-zinc-950/40 px-2 py-2">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void rollSelected()} disabled={rolling || selectedAutomaticTokens.length === 0}
              title="先在地图上选择怪物或 NPC Token；只处理所选对象"
              className="rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/25 disabled:opacity-40">
              {rolling ? '正在掷骰…' : `所选敌人 / NPC 自动先攻${selectedAutomaticTokens.length ? ` (${selectedAutomaticTokens.length})` : ''}`}
            </button>
            <input value={selectedTokens.length ? selectedTokens.map(token => token.name).join('、') : dmName}
              onChange={event => { if (!selectedTokens.length) setDmName(event.target.value); }} readOnly={selectedTokens.length > 0}
              placeholder="手动单位名称或先选择 Token" className="min-w-44 flex-1 rounded bg-zinc-800 px-2 py-1 text-xs" />
            <input value={dmValue} onChange={event => setDmValue(event.target.value)} placeholder="先攻"
              className="w-16 rounded bg-zinc-800 px-2 py-1 text-center text-xs" />
            <button type="button" onClick={addDm}
              disabled={!dmValue.trim() || !Number.isFinite(dmInitiative) || (selectedTokens.length === 0 && !dmName.trim())}
              className="rounded bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40">加入战斗</button>
            {message && <span className="text-[11px] text-zinc-500">{message}</span>}
          </div>
          <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto lg:grid-cols-2 xl:grid-cols-3">
            {entries.map(entry => <CombatantEditor key={entry.id} entry={entry} active={entry.id === activeId} />)}
          </div>
        </div>
      )}
    </section>
  );
}

function CombatantEditor({ entry, active }: { entry: InitiativeEntry; active: boolean }) {
  const [name, setName] = useState(entry.name);
  const [value, setValue] = useState(String(entry.value));
  useEffect(() => { setName(entry.name); }, [entry.name]);
  useEffect(() => { setValue(String(entry.value)); }, [entry.value]);

  const save = () => {
    const initiative = Number(value);
    if (!name.trim() || !Number.isFinite(initiative)) return;
    connection.sendOps([{ op: 'updateCombatant', entryId: entry.id, patch: { name: name.trim(), value: initiative } }]);
  };

  const editGroup = () => {
    const next = window.prompt('输入战斗分组名称；留空表示移出分组', entry.group ?? '');
    if (next === null) return;
    connection.sendOps([{ op: 'updateCombatant', entryId: entry.id, patch: { group: next.trim() || null } }]);
  };

  const toggleTurnState = (turnState: 'ready' | 'delayed') => {
    connection.sendOps([{ op: 'updateCombatant', entryId: entry.id, patch: { turnState: entry.turnState === turnState ? 'normal' : turnState } }]);
  };

  return (
    <div className={`flex min-w-0 items-center gap-1 rounded border px-1.5 py-1 ${active ? 'border-emerald-500/70 bg-emerald-950/30' : entry.defeated ? 'border-red-900/60 bg-red-950/20' : 'border-zinc-800 bg-zinc-900/70'}`}>
      <input value={name} onChange={event => setName(event.target.value)} onBlur={save}
        className="min-w-0 flex-1 rounded bg-transparent px-1 text-xs text-zinc-200 outline-none focus:bg-zinc-800" />
      <input value={value} onChange={event => setValue(event.target.value)} onBlur={save}
        className="w-12 rounded bg-zinc-800 px-1 py-0.5 text-center text-xs text-amber-300" />
      <button type="button" title="重新掷 d20（不含系统调整值）"
        onClick={() => connection.sendOps([{ op: 'updateCombatant', entryId: entry.id, patch: { value: secureD20() } }])}
        className="rounded px-1 py-0.5 text-[10px] text-amber-400 hover:bg-zinc-800">重掷</button>
      <button type="button" title={entry.group ? `当前分组：${entry.group}。点击修改` : '设置战斗分组'} onClick={editGroup}
        className={`max-w-16 truncate rounded px-1 py-0.5 text-[10px] hover:bg-zinc-800 ${entry.group ? 'text-sky-300' : 'text-zinc-500'}`}>
        {entry.group || '分组'}
      </button>
      <button type="button" title="切换准备动作标记；仅作为战术状态，不会隐式改动先攻顺序"
        onClick={() => toggleTurnState('ready')}
        className={`rounded px-1 py-0.5 text-[10px] hover:bg-zinc-800 ${entry.turnState === 'ready' ? 'bg-blue-500/20 text-blue-300' : 'text-zinc-500'}`}>准备</button>
      <button type="button" title="切换延迟行动标记；由主持人显式调整先攻值或推进回合"
        onClick={() => toggleTurnState('delayed')}
        className={`rounded px-1 py-0.5 text-[10px] hover:bg-zinc-800 ${entry.turnState === 'delayed' ? 'bg-orange-500/20 text-orange-300' : 'text-zinc-500'}`}>延迟</button>
      <button type="button" title={entry.hidden ? '向玩家公开' : '从玩家战斗栏隐藏'}
        onClick={() => connection.sendOps([{ op: 'updateCombatant', entryId: entry.id, patch: { hidden: !entry.hidden } }])}
        className={`rounded px-1 py-0.5 text-[10px] ${entry.hidden ? 'text-violet-300' : 'text-zinc-500'}`}>{entry.hidden ? '仅DM' : '公开'}</button>
      <button type="button" title="标记战败；回合导航会自动跳过"
        onClick={() => connection.sendOps([{ op: 'updateCombatant', entryId: entry.id, patch: { defeated: !entry.defeated } }])}
        className={`rounded px-1 py-0.5 text-[10px] ${entry.defeated ? 'bg-red-500/20 text-red-300' : 'text-zinc-500 hover:bg-zinc-800'}`}>战败</button>
      <button type="button" title="移出战斗，保留地图 Token"
        aria-label={`将 ${entry.name} 移出战斗，保留地图 Token`}
        onClick={() => connection.sendOps([{ op: 'removeFromInitiative', entryId: entry.id }])}
        className="rounded px-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400">×</button>
    </div>
  );
}

function secureD20(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % 20 + 1;
}
