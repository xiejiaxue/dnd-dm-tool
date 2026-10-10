import { useEffect, useState, type FormEvent } from 'react';
import { changeHp, emptyCombat, integer, nextTurn, parseQuickCombat, removeCombatEntry, sortInitiative, type QuickCombat } from '../quick-combat';
const key = 'dm-tools:quick-combat:v1';
export default function QuickCalculator() {
  const [state, setState] = useState<QuickCombat>(() => { try { return parseQuickCombat(localStorage.getItem(key)); } catch { return emptyCombat(); } });
  const [history, setHistory] = useState<QuickCombat[]>([]);
  const [name, setName] = useState('');
  const [bonus, setBonus] = useState('0');
  const [hp, setHp] = useState('10');
  const [amount, setAmount] = useState('1');
  const [error, setError] = useState('');
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(state)); } catch { setError('本机存储不可用'); } }, [state]);
  const commit = (next: QuickCombat) => { setHistory(old => [...old.slice(-39), state]); setState(next); };
  const add = (event: FormEvent) => {
    event.preventDefault(); if (!name.trim() || state.entries.length >= 100) return;
    const maxHp = integer(hp, 1);
    commit({ ...state, entries: [...state.entries, { id: crypto.randomUUID(), name: name.trim(), bonus: integer(bonus, -100, 100), initiative: 0, hp: maxHp, maxHp, tempHp: 0 }] });
    setName('');
  };
  const rollAll = () => commit({ ...state, activeId: null, round: 1, entries: state.entries.map(entry => {
    // Rejection sampling avoids modulo bias.
    let value = 0; do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= 4294967280);
    return { ...entry, initiative: value % 20 + 1 + entry.bonus };
  }) });
  return <div className="tool-content">
    <header className="tool-heading"><div><span className="eyebrow">02 / CALCULATOR</span><h1>临时计算器</h1></div><span className="tool-status">本机自动保存</span></header>
    {error && <p role="alert" className="tool-error">{error}</p>}
    <form className="combat-add tool-section" onSubmit={add}>
      <label>名称<input value={name} maxLength={80} required onChange={e => setName(e.target.value)}/></label>
      <label>先攻加值<input type="number" min="-100" max="100" value={bonus} required onChange={e => setBonus(e.target.value)}/></label>
      <label>HP 上限<input type="number" min="1" max="9999" value={hp} required onChange={e => setHp(e.target.value)}/></label>
      <button className="button-primary" disabled={!name.trim() || state.entries.length >= 100}>添加</button>
    </form>
    <div className="combat-controls"><strong>第 {state.round} 轮</strong><button className="button-secondary" disabled={!state.entries.length} onClick={rollAll}>掷先攻</button><button className="button-primary" disabled={!state.entries.length} onClick={() => commit(nextTurn(state))}>{state.activeId ? '下一回合' : '开始回合'}</button><button className="button-secondary" disabled={!history.length} onClick={() => { setState(history[history.length - 1]); setHistory(history.slice(0, -1)); }}>撤销</button><button className="text-link" disabled={!state.entries.length} onClick={() => commit(emptyCombat())}>清空</button><label className="hp-amount">HP 变动<input type="number" min="0" max="9999" value={amount} onChange={e => setAmount(e.target.value)}/></label></div>
    <div className="combat-list" aria-label="先攻列表">
      {!state.entries.length && <p className="tool-empty">暂无参战者</p>}
      {sortInitiative(state.entries).map((entry, index) => <article key={entry.id} className={`combat-row ${state.activeId === entry.id ? 'is-active' : ''}`}>
        <div className="combat-identity"><span className="combat-index">{String(index + 1).padStart(2, '0')}</span><strong>{entry.name}</strong>{state.activeId === entry.id && <span className="current-turn">当前回合</span>}</div>
        <label>先攻<input aria-label={`${entry.name}先攻`} type="number" min="-100" max="100" value={entry.initiative} onChange={e => commit({ ...state, entries: state.entries.map(item => item.id === entry.id ? { ...item, initiative: integer(e.target.value, -100, 100) } : item) })}/></label>
        <div className="hp-readout"><span>HP</span><strong className={entry.hp === 0 ? 'accent' : ''}>{entry.hp}<small> / {entry.maxHp}</small></strong><span>临时 {entry.tempHp}</span><progress aria-label={`${entry.name}生命值`} max={entry.maxHp} value={entry.hp}/></div>
        <div className="hp-actions">{([['damage', '伤害'], ['heal', '治疗'], ['temporary', '临时 HP']] as const).map(([mode,label]) => <button className="button-secondary" key={mode} onClick={() => commit({ ...state, entries: state.entries.map(item => item.id === entry.id ? changeHp(item, Number(amount), mode) : item) })}>{label}</button>)}<button className="remove-entry" aria-label={`移除${entry.name}`} onClick={() => commit(removeCombatEntry(state, entry.id))}>×</button></div>
      </article>)}
    </div>
  </div>;
}
