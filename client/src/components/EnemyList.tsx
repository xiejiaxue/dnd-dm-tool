import { useState } from 'react';
import { connection, useScene } from '../ws';
import DetailDrawer from './DetailDrawer';
import type { Token } from '../types';

// Left-hand panel listing the monster tokens currently in the scene, with HP
// tracking (click to edit current/max), quick delete (DM), a detail button,
// and an "加入先攻" action.
export default function EnemyList() {
  const { scene, role } = useScene();
  const [detail, setDetail] = useState<{ type: 'monster'; id: string; nameZh: string } | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addValue, setAddValue] = useState('');
  const [hpEditId, setHpEditId] = useState<string | null>(null);
  const [hpCur, setHpCur] = useState('');
  const [hpMax, setHpMax] = useState('');
  const tokens = scene?.tokens ?? [];
  const isDm = role === 'dm';

  const inInitiative = (tokenId: string) =>
    (scene?.initiative ?? []).some(e => e.tokenId === tokenId);

  const startAdd = (t: Token) => {
    setAddingId(t.id);
    setAddValue('');
  };

  const commitAdd = (t: Token) => {
    const v = Number(addValue);
    if (Number.isFinite(v)) {
      connection.sendOps([{
        op: 'addToInitiative',
        name: t.number != null ? `${t.name} #${t.number}` : t.name,
        value: v,
        source: 'dm',
        tokenId: t.id,
      }]);
    }
    setAddingId(null);
    setAddValue('');
  };

  const startHpEdit = (t: Token) => {
    setHpEditId(t.id);
    setHpCur(t.hp ? String(t.hp.current) : '');
    setHpMax(t.hp ? String(t.hp.max) : '');
  };

  const commitHp = (t: Token) => {
    const cur = Number(hpCur);
    const max = Number(hpMax);
    if (Number.isFinite(cur) && Number.isFinite(max)) {
      connection.sendOps([{ op: 'updateToken', tokenId: t.id, patch: { hp: { current: cur, max } } }]);
    }
    setHpEditId(null);
    setHpCur('');
    setHpMax('');
  };

  return (
    <aside className="w-52 border-r border-zinc-700/60 bg-zinc-900 flex flex-col text-sm relative">
      <div className="px-2 py-2 border-b border-zinc-800 text-xs text-zinc-400">
        敌人 <span className="text-zinc-500">({tokens.length})</span>
      </div>
      {detail ? (
        <DetailDrawer entry={detail} onBack={() => setDetail(null)} />
      ) : (
        <div className="flex-1 overflow-y-auto">
          {tokens.map(t => {
            const eid = t.entryId;
            if (addingId === t.id) {
              return (
                <div key={t.id} className="flex items-center gap-1 px-2 py-1.5 border-b border-zinc-800/50 bg-zinc-800/50">
                  <span className="flex-1 truncate text-zinc-200">{t.name}{t.number != null ? ` #${t.number}` : ''}</span>
                  <input
                    autoFocus
                    value={addValue}
                    onChange={e => setAddValue(e.target.value)}
                    onBlur={() => commitAdd(t)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitAdd(t);
                      if (e.key === 'Escape') { setAddingId(null); setAddValue(''); }
                    }}
                    placeholder="先攻值"
                    className="w-14 bg-zinc-900 rounded px-1 py-0.5 text-center text-xs"
                  />
                </div>
              );
            }
            if (hpEditId === t.id) {
              return (
                <div key={t.id} className="flex items-center gap-1 px-2 py-1.5 border-b border-zinc-800/50 bg-zinc-800/50">
                  <span className="flex-1 truncate text-zinc-200">{t.name}{t.number != null ? ` #${t.number}` : ''}</span>
                  <span className="text-[10px] text-zinc-500 shrink-0">HP</span>
                  <input
                    autoFocus
                    value={hpCur}
                    onChange={e => setHpCur(e.target.value)}
                    onBlur={() => commitHp(t)}
                    onKeyDown={e => { if (e.key === 'Enter') commitHp(t); if (e.key === 'Escape') { setHpEditId(null); } }}
                    placeholder="当前"
                    className="w-9 bg-zinc-900 rounded px-1 py-0.5 text-center text-xs"
                  />
                  <span className="text-zinc-600 text-xs">/</span>
                  <input
                    value={hpMax}
                    onChange={e => setHpMax(e.target.value)}
                    onBlur={() => commitHp(t)}
                    onKeyDown={e => { if (e.key === 'Enter') commitHp(t); }}
                    placeholder="最大"
                    className="w-9 bg-zinc-900 rounded px-1 py-0.5 text-center text-xs"
                  />
                </div>
              );
            }
            return (
              <div key={t.id} className="flex items-center gap-1 px-2 py-1.5 border-b border-zinc-800/50 hover:bg-zinc-800/50">
                <span className="flex-1 truncate text-zinc-200">{t.name}{t.number != null ? ` #${t.number}` : ''}</span>
                <button
                  onClick={() => startHpEdit(t)}
                  title="修改 HP"
                  className={`shrink-0 px-1 py-0.5 rounded text-[10px] font-semibold hover:bg-zinc-700 ${
                    !t.hp ? 'text-zinc-600' : t.hp.current <= 0 ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >{t.hp ? `${t.hp.current}/${t.hp.max}` : 'HP:—'}</button>
                {eid && (
                  <button
                    onClick={() => setDetail({ type: 'monster', id: eid, nameZh: t.name })}
                    title="显示详细数据"
                    className="shrink-0 w-6 h-6 rounded hover:bg-zinc-700 text-zinc-400 hover:text-amber-400"
                  >📖</button>
                )}
                {isDm && !inInitiative(t.id) && (
                  <button
                    onClick={() => startAdd(t)}
                    title="加入先攻"
                    className="shrink-0 px-1 py-0.5 rounded hover:bg-emerald-700/30 text-emerald-400 text-xs"
                  >先攻</button>
                )}
                {isDm && inInitiative(t.id) && (
                  <span title="已在先攻列表" className="shrink-0 px-1 py-0.5 text-[10px] text-emerald-600">已入</span>
                )}
                {isDm && (
                  <button
                    onClick={() => connection.sendOps([{ op: 'removeToken', tokenId: t.id }])}
                    title="删除 token"
                    className="shrink-0 w-6 h-6 rounded hover:bg-zinc-700 text-zinc-400 hover:text-red-400"
                  >✕</button>
                )}
              </div>
            );
          })}
          {tokens.length === 0 && <div className="p-3 text-zinc-500 text-xs">暂无敌人 token</div>}
        </div>
      )}
    </aside>
  );
}
