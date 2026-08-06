import { useRef, useState, type ChangeEvent } from 'react';
import { connection, getMySessionId, useScene } from '../ws';
import { uploadImage } from '../upload';
import DetailDrawer from './DetailDrawer';
import type { PlayerToken, Token } from '../types';

// Player token color choices (same palette the DM sees when placing a player).
const PALETTE = ['#e53e3e', '#38a169', '#3182ce', '#d69e2e', '#805ad5', '#dd6b20', '#319795', '#d53f8c'];

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
  const [editName, setEditName] = useState(false);
  const [nameVal, setNameVal] = useState('');
  const [hpEdit, setHpEdit] = useState(false);
  const tokens = scene?.tokens ?? [];
  const isDm = role === 'dm';
  // Locate this player's own token, bound to their stable browser session id.
  const mySessionId = getMySessionId();
  const myToken: PlayerToken | undefined = scene?.players.find(p => p.sessionId === mySessionId);
  const avatarRef = useRef<HTMLInputElement>(null);

  const onAvatarPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !myToken) return;
    try {
      const url = await uploadImage(file, 'token');
      connection.sendOps([{ op: 'updatePlayer', tokenId: myToken.id, patch: { avatar: url } }]);
    } catch {
      /* upload failed — keep the current avatar */
    }
  };

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
      {role === 'player' && myToken && (
        <div className="px-2 py-2 border-b border-zinc-800 bg-zinc-800/30">
          <div className="text-xs text-zinc-400 mb-1">我的角色</div>
          <div className="flex items-center gap-1.5">
            {editName ? (
              <input autoFocus value={nameVal} onChange={e => setNameVal(e.target.value)}
                onBlur={() => { if (nameVal.trim()) connection.sendOps([{ op: 'updatePlayer', tokenId: myToken.id, patch: { name: nameVal.trim().slice(0, 20) } }]); setEditName(false); }}
                onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                className="flex-1 min-w-0 bg-zinc-900 rounded px-1 py-0.5 text-sm" />
            ) : (
              <button className="flex-1 min-w-0 text-left truncate text-zinc-100"
                onClick={() => { setNameVal(myToken.name); setEditName(true); }}>{myToken.name} ✎</button>
            )}
            <span className="shrink-0 text-[10px] text-zinc-500">HP</span>
            {hpEdit ? (
              <input autoFocus value={hpCur} onChange={e => setHpCur(e.target.value)}
                onBlur={() => { const c = Number(hpCur), m = Number(hpMax); if (Number.isFinite(c) && Number.isFinite(m)) connection.sendOps([{ op: 'updatePlayer', tokenId: myToken.id, patch: { hp: { current: c, max: m } } }]); setHpEdit(false); }}
                onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                className="w-8 bg-zinc-900 rounded px-1 py-0.5 text-center text-xs" />
            ) : (
              <button className="shrink-0 text-emerald-400 text-xs" onClick={() => { setHpCur(String(myToken.hp?.current ?? '')); setHpMax(String(myToken.hp?.max ?? '')); setHpEdit(true); }}>
                {myToken.hp ? `${myToken.hp.current}/${myToken.hp.max}` : '—'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {PALETTE.map(c => (
              <button key={c} onClick={() => connection.sendOps([{ op: 'updatePlayer', tokenId: myToken.id, patch: { color: c } }])}
                className={`w-4 h-4 rounded-full ${myToken.color === c ? 'ring-2 ring-white' : ''}`} style={{ background: c }} />
            ))}
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            {myToken.avatar ? (
              <img src={myToken.avatar} alt="" className="w-8 h-8 rounded-full object-cover bg-zinc-700 shrink-0" />
            ) : (
              <span className="w-8 h-8 rounded-full shrink-0" style={{ background: myToken.color }} />
            )}
            <button onClick={() => avatarRef.current?.click()}
              className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-xs">上传头像</button>
            {myToken.avatar && (
              <button onClick={() => connection.sendOps([{ op: 'updatePlayer', tokenId: myToken.id, patch: { avatar: '' } }])}
                className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-500 hover:text-red-400 text-xs">移除</button>
            )}
            <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={onAvatarPicked} />
          </div>
          <div className="text-[10px] text-zinc-600 mt-1">拖动画布上的 token 可移动位置</div>
        </div>
      )}
      <div className="px-2 py-2 border-b border-zinc-800 text-xs text-zinc-400 flex items-center justify-between gap-1">
        <span>敌人 <span className="text-zinc-500">({tokens.length})</span></span>
        {isDm && (
          <button
            onClick={() => connection.sendControl({ type: 'rollInitiative' })}
            title="对场景内所有怪物掷 d20+敏捷调整值，加入/重掷先攻"
            className="shrink-0 px-1.5 py-0.5 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 text-[10px]"
          >自动随机先攻</button>
        )}
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
