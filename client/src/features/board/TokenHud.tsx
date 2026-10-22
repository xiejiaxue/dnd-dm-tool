import { useMemo } from 'react';
import type { Encounter, Op, PlayerToken, Token, TokenConditionId } from '../../types';
import { connection } from '../../ws';
import { CONDITION_DEFINITIONS } from '../conditions/model';
import { openEncounterReference } from '../encounter/navigation';

type BoardToken = Token | PlayerToken;

interface Props {
  token: BoardToken;
  selectedTokens: BoardToken[];
  encounter: Encounter | null;
  style: { left: number; top: number };
  onClose(): void;
  onDelete(): void;
  onPerformOps(label: string, operations: Op[]): void;
}

export default function TokenHud({ token, selectedTokens, encounter, style, onClose, onDelete, onPerformOps }: Props) {
  const selected = selectedTokens.length ? selectedTokens : [token];
  const combatants = useMemo(
    () => new Map((encounter?.combatants ?? []).flatMap(entry => entry.tokenId ? [[entry.tokenId, entry] as const] : [])),
    [encounter],
  );
  const allInCombat = selected.every(item => combatants.has(item.id));
  const allHidden = selected.filter(item => item.kind !== 'player').every(item => item.hidden === true);

  const sendTokenPatches = (label: string, patchFor: (item: BoardToken) => Partial<Token>): void => {
    const operations = selected.reduce<Op[]>((result, item) => {
      const patch = patchFor(item);
      if (Object.keys(patch).length === 0) return result;
      if (item.kind === 'player') {
        const allowed: Extract<Op, { op: 'updatePlayer' }>['patch'] = {};
        if (patch.hp) allowed.hp = patch.hp;
        if (patch.conditions) allowed.conditions = patch.conditions;
        if (Object.keys(allowed).length) result.push({ op: 'updatePlayer', tokenId: item.id, patch: allowed });
        return result;
      }
      result.push({ op: 'updateToken', tokenId: item.id, patch });
      return result;
    }, []);
    onPerformOps(label, operations);
  };

  const adjustHp = (delta: number) => sendTokenPatches('调整 Token HP', item => item.hp
    ? { hp: { current: Math.max(-10_000, Math.min(item.hp.max, item.hp.current + delta)), max: item.hp.max } }
    : {});

  const setHp = () => {
    if (selected.length !== 1) return;
    const current = selected[0].hp;
    const answer = window.prompt('输入当前 HP / 最大 HP', current ? `${current.current}/${current.max}` : '1/1');
    if (!answer) return;
    const match = /^\s*(-?\d+)\s*\/\s*(\d+)\s*$/u.exec(answer);
    if (!match) return;
    const hp = { current: Number(match[1]), max: Number(match[2]) };
    if (!Number.isFinite(hp.current) || !Number.isFinite(hp.max) || hp.max < 1) return;
    sendTokenPatches('设置 Token HP', () => ({ hp }));
  };

  const toggleCondition = (id: TokenConditionId, duration: number | null = null) => {
    const allHave = selected.every(item => item.conditions?.some(condition => condition.id === id));
    sendTokenPatches('切换状态', item => ({
      conditions: allHave
        ? (item.conditions ?? []).filter(condition => condition.id !== id)
        : item.conditions?.some(condition => condition.id === id)
          ? (item.conditions ?? []).map(condition => condition.id === id ? { ...condition, remainingRounds: duration } : { ...condition })
          : [...(item.conditions ?? []), { id, remainingRounds: duration }],
    }));
  };

  const setDuration = (id: TokenConditionId) => {
    const answer = window.prompt('持续轮数；留空表示持续到手动清除', '1');
    if (answer === null) return;
    const duration = answer.trim() === '' ? null : Number(answer);
    if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 99)) return;
    sendTokenPatches('设置状态持续轮数', item => ({
      conditions: item.conditions?.some(condition => condition.id === id)
        ? (item.conditions ?? []).map(condition => condition.id === id ? { ...condition, remainingRounds: duration } : { ...condition })
        : [...(item.conditions ?? []), { id, remainingRounds: duration }],
    }));
  };

  const toggleCombat = () => {
    if (allInCombat) {
      connection.sendOps(selected.flatMap(item => {
        const entry = combatants.get(item.id);
        return entry ? [{ op: 'removeFromInitiative' as const, entryId: entry.id }] : [];
      }));
      return;
    }
    const answer = window.prompt(`为 ${selected.length} 个 Token 输入先攻值`, '10');
    if (answer === null) return;
    const value = Number(answer);
    if (!Number.isFinite(value)) return;
    connection.sendOps(selected.flatMap(item => combatants.has(item.id) ? [] : [{
      op: 'addToInitiative' as const,
      name: item.number != null ? `${item.name} #${item.number}` : item.name,
      value,
      source: 'dm' as const,
      tokenId: item.id,
    }]));
  };

  const cycleHpVisibility = () => {
    const current = token.hpVisibility ?? 'value';
    const next = current === 'value' ? 'bar' : current === 'bar' ? 'none' : 'value';
    sendTokenPatches('切换 HP 可见性', item => item.kind === 'player' ? {} : { hpVisibility: next });
  };

  const setPublicName = () => {
    if (selected.length !== 1 || token.kind === 'player') return;
    const value = window.prompt('玩家看到的称谓；留空显示真实名称', token.publicName ?? '');
    if (value === null) return;
    sendTokenPatches('设置玩家称谓', item => item.id === token.id ? { publicName: value.trim().slice(0, 120) } : {});
  };

  return (
    <section
      aria-label="Token 快捷操作"
      className="absolute z-30 w-72 overflow-hidden rounded-lg border border-zinc-600 bg-zinc-950/95 text-xs shadow-2xl shadow-black/60 backdrop-blur"
      style={{ left: style.left, top: style.top, transform: 'translate(-50%, -100%)' }}
      onMouseDown={event => event.stopPropagation()}
    >
      <header className="flex items-center gap-2 border-b border-zinc-800 px-2.5 py-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-zinc-100">
          {selected.length > 1 ? `已选择 ${selected.length} 个 Token` : token.name}
        </span>
        <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-100" aria-label="关闭 Token 快捷操作" title="关闭 Token 快捷操作">×</button>
      </header>

      <div className="grid grid-cols-4 gap-1 p-2">
        <button type="button" onClick={() => adjustHp(-5)} className="rounded bg-zinc-800 py-1.5 text-red-300 hover:bg-zinc-700">HP −5</button>
        <button type="button" onClick={() => adjustHp(-1)} className="rounded bg-zinc-800 py-1.5 text-red-300 hover:bg-zinc-700">HP −1</button>
        <button type="button" onClick={() => adjustHp(1)} className="rounded bg-zinc-800 py-1.5 text-emerald-300 hover:bg-zinc-700">HP +1</button>
        <button type="button" onClick={() => adjustHp(5)} className="rounded bg-zinc-800 py-1.5 text-emerald-300 hover:bg-zinc-700">HP +5</button>
        <button type="button" onClick={setHp} disabled={selected.length !== 1}
          className="col-span-2 rounded bg-zinc-800 py-1.5 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40">
          {selected.length === 1 && token.hp ? `${token.hp.current} / ${token.hp.max}` : '设置 HP'}
        </button>
        <button type="button" onClick={toggleCombat}
          className="col-span-2 rounded bg-emerald-500/15 py-1.5 text-emerald-300 hover:bg-emerald-500/25">
          {allInCombat ? '移出战斗' : '加入战斗'}
        </button>
      </div>

      <div className="border-t border-zinc-800 p-2">
        <div className="mb-1.5 flex items-center justify-between text-[10px] text-zinc-500">
          <span>状态标记</span><span>右键设置持续轮数</span>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {CONDITION_DEFINITIONS.map(definition => {
            const active = selected.some(item => item.conditions?.some(condition => condition.id === definition.id));
            return (
              <button key={definition.id} type="button" onClick={() => toggleCondition(definition.id)}
                onContextMenu={event => { event.preventDefault(); setDuration(definition.id); }}
                className={`rounded border px-1 py-1.5 ${active ? 'border-amber-500/60 bg-amber-500/15 text-amber-200' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600'}`}>
                {definition.label}
              </button>
            );
          })}
        </div>
      </div>

      <footer className="flex flex-wrap gap-1 border-t border-zinc-800 p-2">
        {selected.some(item => item.kind !== 'player') && (
          <button type="button" onClick={() => sendTokenPatches('切换 Token 可见性', item => item.kind === 'player' ? {} : { hidden: !allHidden })}
            className="rounded bg-violet-500/15 px-2 py-1.5 text-violet-300 hover:bg-violet-500/25">
            {allHidden ? '向玩家公开' : '仅主持人可见'}
          </button>
        )}
        {selected.some(item => item.kind !== 'player') && (
          <button type="button" onClick={cycleHpVisibility}
            className="rounded bg-zinc-800 px-2 py-1.5 text-zinc-300 hover:bg-zinc-700">
            HP：{token.hpVisibility === 'none' ? '隐藏' : token.hpVisibility === 'bar' ? '仅血条' : '数值'}
          </button>
        )}
        {selected.length === 1 && token.kind !== 'player' && (
          <button type="button" onClick={setPublicName}
            className="rounded bg-zinc-800 px-2 py-1.5 text-zinc-300 hover:bg-zinc-700">玩家称谓</button>
        )}
        {selected.length === 1 && token.kind !== 'player' && (
          <button type="button" onClick={() => openEncounterReference(token.id)}
            className="rounded bg-sky-500/15 px-2 py-1.5 text-sky-300 hover:bg-sky-500/25">打开速查</button>
        )}
        <button type="button" onClick={onDelete}
          className="ml-auto rounded bg-red-500/15 px-2 py-1.5 text-red-300 hover:bg-red-500/25">删除 Token</button>
      </footer>
    </section>
  );
}
