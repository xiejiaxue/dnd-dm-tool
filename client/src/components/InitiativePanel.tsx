import { useEffect, useRef, useState } from 'react';
import { connection, getMySessionId, useScene } from '../ws';

interface Props {
  selectedTokenId?: string | null;
  onClearSelected?: () => void;
}

export default function InitiativePanel({ selectedTokenId, onClearSelected }: Props) {
  const { scene, role } = useScene();
  const [value, setValue] = useState('');
  const [dmName, setDmName] = useState('');
  const [dmValue, setDmValue] = useState('');
  const entries = scene?.initiative ?? [];
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
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    // Stable sessionId: the server upserts by it, so re-submitting updates the
    // same initiative entry instead of creating duplicates.
    connection.sendOps([{ op: 'submitInitiative', name: myToken?.name ?? `玩家${value}`, value: v, tokenId: myToken?.id ?? null, sessionId: mySessionId }]);
    setValue('');
  };

  // DM add: uses the board-selected token when one is picked, otherwise a typed
  // name + value (manual add). tokenId links the entry to a board token so the
  // active-turn gold ring can highlight it.
  const addDm = () => {
    const v = Number(dmValue);
    const name = selectedToken ? selectedToken.name : dmName.trim();
    if (!name || !Number.isFinite(v)) return;
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
    <div className="h-14 border-b border-zinc-700/60 bg-zinc-900 flex items-center px-2 gap-2 text-sm">
      <span className="text-zinc-500 shrink-0">先攻</span>
      {/* 先攻条目：固定长度的可滚动区，条目多时滚动而右侧控件不被推出屏幕 */}
      <div ref={scrollRef} className="flex-1 min-w-0 overflow-x-auto flex items-center gap-2 h-full py-2">
        {entries.map(e => (
          <div key={e.id} data-ini={e.id}
            className={`shrink-0 px-2 py-0.5 rounded flex items-center gap-1.5 ${e.active ? 'bg-emerald-700/60 text-white ring-1 ring-emerald-400' : 'bg-zinc-800 text-zinc-300'}`}>
            <span>{e.name}</span>
            <span className={e.active ? 'text-emerald-200' : 'text-amber-400'}>{e.value}</span>
            {role === 'dm' && (
              <button className="text-zinc-500 hover:text-red-400"
                onClick={() => connection.sendOps([{ op: 'removeFromInitiative', entryId: e.id }])}>✕</button>
            )}
          </div>
        ))}
      </div>
      {role === 'dm' && (
        <div className="shrink-0 flex items-center gap-1">
          {selectedToken ? (
            <span className="text-emerald-300 text-xs shrink-0">已选: {selectedToken.name}</span>
          ) : (
            <input value={dmName} onChange={e => setDmName(e.target.value)} placeholder="名称"
              className="w-20 bg-zinc-800 rounded px-1 py-0.5 text-xs" />
          )}
          <input value={dmValue} onChange={e => setDmValue(e.target.value)} placeholder="先攻值"
            className="w-12 bg-zinc-800 rounded px-1 py-0.5 text-center text-xs" />
          <button onClick={addDm} className="px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30">加入先攻</button>
        </div>
      )}
      {role === 'dm' && (
        <button
          onClick={() => connection.sendOps([{ op: 'advanceTurn' }])}
          className="shrink-0 px-2 py-1 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30">
          ⏭ 下一回合
        </button>
      )}
      {role === 'player' && (
        <div className="shrink-0 flex items-center gap-1">
          <span className="text-emerald-300 text-xs shrink-0">{myToken ? myToken.name : '未认领角色'}</span>
          <input value={value} onChange={e => setValue(e.target.value)} placeholder="先攻值"
            className="w-16 bg-zinc-800 rounded px-2 py-0.5 text-center" />
          <button onClick={submit} disabled={!myToken}
            className="px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 disabled:opacity-40">提交</button>
        </div>
      )}
    </div>
  );
}
