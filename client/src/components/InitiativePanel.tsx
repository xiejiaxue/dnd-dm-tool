import { useState } from 'react';
import { connection, useScene } from '../ws';

interface Props {
  selectedTokenId?: string | null;
  onClearSelected?: () => void;
}

export default function InitiativePanel({ selectedTokenId, onClearSelected }: Props) {
  const { scene, role } = useScene();
  const [value, setValue] = useState('');
  const [myToken, setMyToken] = useState('');
  const [dmName, setDmName] = useState('');
  const [dmValue, setDmValue] = useState('');
  const entries = scene?.initiative ?? [];
  const selectedToken = scene
    ? scene.tokens.find(t => t.id === selectedTokenId) ?? scene.players.find(p => p.id === selectedTokenId)
    : undefined;

  const submit = () => {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    // Stable sessionId: the server upserts by it, so re-submitting updates the
    // same initiative entry instead of creating duplicates.
    let sid = localStorage.getItem('player-session-id');
    if (!sid) {
      sid = crypto.randomUUID();
      localStorage.setItem('player-session-id', sid);
    }
    connection.sendOps([{ op: 'submitInitiative', name: `玩家${value}`, value: v, tokenId: myToken || null, sessionId: sid }]);
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
    <div className="h-14 border-b border-zinc-700/60 bg-zinc-900 flex items-center px-2 gap-2 text-sm overflow-x-auto">
      <span className="text-zinc-500 shrink-0">先攻</span>
      {entries.map(e => (
        <div key={e.id}
          className={`shrink-0 px-2 py-0.5 rounded flex items-center gap-1.5 ${e.active ? 'bg-emerald-700/60 text-white ring-1 ring-emerald-400' : 'bg-zinc-800 text-zinc-300'}`}>
          <span>{e.name}</span>
          <span className={e.active ? 'text-emerald-200' : 'text-amber-400'}>{e.value}</span>
          {role === 'dm' && (
            <button className="text-zinc-500 hover:text-red-400"
              onClick={() => connection.sendOps([{ op: 'removeFromInitiative', entryId: e.id }])}>✕</button>
          )}
        </div>
      ))}
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
          className="ml-auto shrink-0 px-2 py-1 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30">
          ⏭ 下一回合
        </button>
      )}
      {role === 'player' && (
        <div className="ml-auto shrink-0 flex items-center gap-1">
          <select value={myToken} onChange={e => setMyToken(e.target.value)} className="bg-zinc-800 rounded px-1 py-0.5 text-xs">
            <option value="">我的角色</option>
            {(scene?.players ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input value={value} onChange={e => setValue(e.target.value)} placeholder="先攻值"
            className="w-16 bg-zinc-800 rounded px-2 py-0.5 text-center" />
          <button onClick={submit} className="px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30">提交</button>
        </div>
      )}
    </div>
  );
}
