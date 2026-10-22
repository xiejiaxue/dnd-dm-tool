import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { rollExpression, type RollResult } from '../dice';

/**
 * Session calculator: dice expressions, a directly-entered, auto-sorted
 * initiative order and HP tracking. State persists to this browser's
 * localStorage (it is personal prep data, never sent to the server).
 */

interface Combatant { id: number; name: string; value: number }
interface HpTracker { id: number; name: string; cur: number; max: number; amount: number }
interface DiceRecord { expr: string; total: number; detail: string }
interface DiceStore { last: DiceRecord | null; history: DiceRecord[] }

const DICE_KEY = 'dnd-dm-calc-dice-v1';
const INITIATIVE_KEY = 'dnd-dm-calc-initiative-v1';
const HP_KEY = 'dnd-dm-calc-hp-v1';

function stored<T>(key: string, fallback: T, isValid: (value: unknown) => value is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function usePersistentState<T>(key: string, fallback: T, isValid: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => stored(key, fallback, isValid));
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 隐私模式等存储不可用场景下静默降级为会话内状态。
    }
  }, [key, value]);
  return [value, setValue] as const;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function isCombatantList(value: unknown): value is Combatant[] {
  return Array.isArray(value) && value.every(item =>
    typeof item === 'object' && item !== null
    && isNumber((item as Combatant).id)
    && typeof (item as Combatant).name === 'string'
    && isNumber((item as Combatant).value));
}

function isTrackerList(value: unknown): value is HpTracker[] {
  return Array.isArray(value) && value.every(item =>
    typeof item === 'object' && item !== null
    && isNumber((item as HpTracker).id)
    && typeof (item as HpTracker).name === 'string'
    && isNumber((item as HpTracker).cur)
    && isNumber((item as HpTracker).max)
    && isNumber((item as HpTracker).amount));
}

function isDiceStore(value: unknown): value is DiceStore {
  if (typeof value !== 'object' || value === null) return false;
  const store = value as DiceStore;
  const isRecord = (r: unknown) => typeof r === 'object' && r !== null
    && typeof (r as DiceRecord).expr === 'string'
    && isNumber((r as DiceRecord).total)
    && typeof (r as DiceRecord).detail === 'string';
  if (store.last !== null && !isRecord(store.last)) return false;
  return Array.isArray(store.history) && store.history.every(isRecord);
}

const numInputCls = 'field w-auto text-right tabular-nums';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-4">
      <h3 className="panel-label">{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function DicePad() {
  const [store, setStore] = usePersistentState<DiceStore>(
    DICE_KEY, { last: null, history: [] }, isDiceStore,
  );
  const [expr, setExpr] = useState('');
  const [error, setError] = useState(false);
  const { last, history } = store;

  const roll = (event: FormEvent) => {
    event.preventDefault();
    const result: RollResult | null = rollExpression(expr);
    if (!result) { setError(true); return; }
    setError(false);
    const record = { expr: expr.trim(), total: result.total, detail: result.detail };
    setStore({ last: record, history: [record, ...store.history].slice(0, 5) });
  };

  return (
    <Section title="骰点">
      <form onSubmit={roll} className="flex gap-2">
        <input
          value={expr}
          onChange={event => setExpr(event.target.value)}
          placeholder="如 1d20+5"
          spellCheck={false}
          className="field flex-1 tabular-nums"
        />
        <button type="submit" className="btn-primary">掷</button>
      </form>
      {error && <p className="mt-2 text-xs text-accent">无法识别的表达式</p>}
      {last && (
        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-5xl font-bold leading-none tabular-nums tracking-tight">{last.total}</span>
          <span className="min-w-0 truncate text-xs text-muted tabular-nums">{last.expr} = {last.detail}</span>
        </div>
      )}
      {history.length > 1 && (
        <ul className="mt-4 space-y-1 border-t border-line pt-2">
          {history.slice(1).map((record, i) => (
            <li key={i} className="flex justify-between gap-2 text-xs text-muted tabular-nums">
              <span className="truncate">{record.expr}</span>
              <span className="text-ink font-medium">{record.total}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function InitiativePad() {
  const [combatants, setCombatants] = usePersistentState<Combatant[]>(
    INITIATIVE_KEY, [{ id: 0, name: '', value: 0 }], isCombatantList,
  );
  const nextId = useRef(Math.max(0, ...combatants.map(c => c.id)) + 1);
  // 先攻值高者在前；同值保持录入顺序（稳定排序）。
  const sorted = useMemo(
    () => [...combatants].sort((a, b) => b.value - a.value),
    [combatants],
  );

  const update = (id: number, patch: Partial<Combatant>) =>
    setCombatants(list => list.map(c => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <Section title="先攻">
      <ol className="space-y-2">
        {sorted.map((c, index) => (
          <li key={c.id} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-xs text-faint tabular-nums">{index + 1}.</span>
            <input
              value={c.name}
              onChange={event => update(c.id, { name: event.target.value })}
              placeholder="名字"
              className="field flex-1"
            />
            <input
              type="number"
              value={c.value}
              onChange={event => update(c.id, { value: Number(event.target.value) || 0 })}
              title="先攻值"
              aria-label={`先攻值：${c.name || '未命名'}`}
              className={numInputCls}
            />
            <button
              onClick={() => setCombatants(list => list.filter(x => x.id !== c.id))}
              title="移除"
              className="shrink-0 px-1 text-faint hover:text-accent transition-colors duration-150"
            >✕</button>
          </li>
        ))}
      </ol>
      <button
        onClick={() => setCombatants(list => [...list, { id: nextId.current++, name: '', value: 0 }])}
        className="btn-quiet mt-3"
      >＋ 添加</button>
    </Section>
  );
}

function HpPad() {
  const [trackers, setTrackers] = usePersistentState<HpTracker[]>(
    HP_KEY, [{ id: 0, name: '', cur: 10, max: 10, amount: 5 }], isTrackerList,
  );
  const nextId = useRef(Math.max(0, ...trackers.map(t => t.id)) + 1);

  const update = (id: number, patch: Partial<HpTracker>) =>
    setTrackers(list => list.map(t => (t.id === id ? { ...t, ...patch } : t)));

  const apply = (id: number, delta: number) => {
    setTrackers(list => list.map(t => {
      if (t.id !== id) return t;
      const max = Math.max(1, t.max || 1);
      const cur = Math.min(max, Math.max(0, (t.cur || 0) + delta));
      return { ...t, cur, max };
    }));
  };

  const ratio = (t: HpTracker) => Math.max(0, Math.min(1, (t.cur || 0) / Math.max(1, t.max || 1)));

  return (
    <Section title="生命值">
      <div className="space-y-5">
        {trackers.map(t => {
          const pct = Math.round(ratio(t) * 100);
          const low = pct <= 30;
          return (
            <div key={t.id}>
              <div className="flex items-center gap-2">
                <input value={t.name} onChange={event => update(t.id, { name: event.target.value })} placeholder="名字" className="field flex-1" />
                <input type="number" min={1} value={t.max} onChange={event => update(t.id, {
                  max: Math.max(1, Number(event.target.value) || 1),
                })} title="最大生命值" className={numInputCls} />
                <button onClick={() => setTrackers(list => list.filter(x => x.id !== t.id))} title="移除"
                  className="shrink-0 px-1 text-faint hover:text-accent transition-colors duration-150">✕</button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className={`w-16 shrink-0 text-sm font-bold tabular-nums ${low ? 'text-accent' : 'text-ink'}`}>
                  {t.cur || 0}<span className="font-normal text-faint">/{t.max}</span>
                </span>
                <div className="h-1.5 flex-1 bg-well">
                  <div className={`h-full ${low ? 'bg-accent' : 'bg-ink'}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted">{pct}%</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input type="number" min={0} value={t.amount} onChange={event => update(t.id, { amount: Math.max(0, Number(event.target.value) || 0) })}
                  title="数值" className={numInputCls} />
                <button onClick={() => apply(t.id, -t.amount)} className="btn-danger flex-1">− 伤害</button>
                <button onClick={() => apply(t.id, +t.amount)} className="btn-quiet flex-1">＋ 治疗</button>
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={() => setTrackers(list => [...list, { id: nextId.current++, name: '', cur: 10, max: 10, amount: 5 }])}
        className="btn-quiet mt-4">＋ 新增追踪</button>
    </Section>
  );
}

export default function SessionCalculator() {
  return (
    <div className="space-y-5 [&>div:first-child]:border-t-0 [&>div:first-child]:pt-0">
      <DicePad />
      <InitiativePad />
      <HpPad />
    </div>
  );
}
