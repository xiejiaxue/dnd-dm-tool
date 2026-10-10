import { useEffect, useRef, useState } from 'react';
import { connection, getMySessionId, useScene } from '../ws';

interface Props {
  selectedTokenId?: string | null;
  onClearSelected?: () => void;
}

export function parseInitiativeValue(input: string): number | null {
  if (!input.trim()) return null;
  const value = Number(input);
  return Number.isFinite(value) && value >= -100 && value <= 100 ? value : null;
}

export default function InitiativePanel({ selectedTokenId, onClearSelected }: Props) {
  const { scene, role } = useScene();
  const [value, setValue] = useState('');
  const [dmName, setDmName] = useState('');
  const [dmValue, setDmValue] = useState('');
  const entries = scene?.initiative ?? [];
  const playerValue = parseInitiativeValue(value);
  const moderatorValue = parseInitiativeValue(dmValue);
  useEffect(() => {
    setValue('');setDmName('');setDmValue('');
  }, [scene?.id, role]);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Active turn id: auto-scroll so the current tag is always visible in the strip.
  const activeId = scene?.initiative.find(e => e.active)?.id ?? null;
  // The player's own token, matched by the stable sessionId the browser sends on
  // init. The server auto-creates the token for this session on the first init.
  const mySessionId = getMySessionId();
  const myToken = scene?.players.find(p => p.sessionId === mySessionId) ?? null;

  useEffect(() => {
    if (!activeId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>(`[data-ini="${activeId}"]`);
    if (el) {
      const container = scrollRef.current;
      const targetLeft = el.offsetLeft - container.clientWidth / 2 + el.clientWidth / 2;
      container.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
    }
  }, [activeId]);
  const selectedToken = scene
    ? scene.tokens.find(t => t.id === selectedTokenId) ?? scene.players.find(p => p.id === selectedTokenId)
    : undefined;

  const submit = () => {
    const v = playerValue;
    if (!myToken || v === null) return;
    // Stable sessionId: the server upserts by it, so re-submitting updates the
    // same initiative entry instead of creating duplicates.
    connection.sendOps([{ op: 'submitInitiative', name: myToken?.name ?? `玩家${value}`, value: v, tokenId: myToken?.id ?? null, sessionId: mySessionId }]);
    setValue('');
  };

  // DM add: uses the board-selected token when one is picked, otherwise a typed
  // name + value (manual add). tokenId links the entry to a board token so the
  // active-turn gold ring can highlight it.
  const addDm = () => {
    const v = moderatorValue;
    const name = selectedToken ? selectedToken.name : dmName.trim();
    if (!name || v === null) return;
    connection.sendOps([{
      op: 'addToInitiative',
      name,
      value: v,
      source: 'dm',
      tokenId: selectedToken ? selectedToken.id : null,
    }]);
    setDmName('');
    setDmValue('');
    onClearSelected?.();
  };

  return (
    <section className="campaign-initiative" aria-label="战斗先攻">
      <span className="panel-label shrink-0">先攻</span>
      {/* 先攻条目：固定长度的可滚动区，条目多时滚动而右侧控件不被推出屏幕 */}
      <div ref={scrollRef} className="campaign-turn-order">
        {entries.map(e => (
          <div key={e.id} data-ini={e.id}
            className={`shrink-0 px-2 flex items-center gap-1.5 border transition-colors duration-150 ${
              e.active ? 'border-ink bg-ink text-white' : 'border-line bg-panel text-ink'
            }`}>
            <span className="text-xs">{e.name}</span>
            <span className={`text-xs font-bold tabular-nums ${e.active ? 'text-[#ff5140]' : 'text-ink'}`}>{e.value}</span>
            {role === 'dm' && (
              <button aria-label={`移除 ${e.name} 的先攻`}
                className={e.active ? 'text-white/50 hover:text-accent' : 'text-faint hover:text-accent'}
                onClick={() => connection.sendOps([{ op: 'removeFromInitiative', entryId: e.id }])}>✕</button>
            )}
          </div>
        ))}
      </div>
      {role === 'dm' && (
        <div className="shrink-0 flex items-center gap-1.5">
          {selectedToken ? (
            <span className="text-xs text-accent shrink-0">已选: {selectedToken.name}</span>
          ) : (
            <input value={dmName} onChange={e => setDmName(e.target.value)} placeholder="角色名称" aria-label="先攻角色名称"
              className="field-sm w-20" />
          )}
          <input value={dmValue} onChange={e => setDmValue(e.target.value)} placeholder="先攻值" aria-label="先攻值" inputMode="decimal" aria-invalid={Boolean(dmValue.trim()) && moderatorValue === null} onKeyDown={e => { if (e.key === 'Enter') addDm(); }}
            className="field-sm w-12 text-center tabular-nums" />
          <button onClick={addDm} disabled={moderatorValue === null || (!selectedToken && !dmName.trim())} className="btn-primary">加入先攻</button>
        </div>
      )}
      {role === 'dm' && (
        <button
          onClick={() => connection.sendOps([{ op: 'advanceTurn' }])}
          disabled={!entries.length}
          className="btn-accent shrink-0">
          下一回合
        </button>
      )}
      {role === 'player' && (
        <div className="shrink-0 flex items-center gap-1.5">
          <span className="text-xs text-ink shrink-0">{myToken ? myToken.name : '未认领角色'}</span>
          <input value={value} onChange={e => setValue(e.target.value)} placeholder="先攻值" aria-label="我的先攻值" inputMode="decimal" aria-invalid={Boolean(value.trim()) && playerValue === null} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            className="field-sm w-16 text-center tabular-nums" />
          <button onClick={submit} disabled={!myToken || playerValue === null}
            className="btn-primary">提交</button>
        </div>
      )}
    </section>
  );
}
