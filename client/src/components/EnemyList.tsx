import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { connection, getMySessionId, useScene } from '../ws';
import { uploadImage } from '../upload';
import DetailDrawer from './DetailDrawer';
import ConfirmButton from './ConfirmButton';
import type { PlayerToken, Token } from '../types';
import { resolveHpInput } from '../hp-input';

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
  // Mirrors hpEditId synchronously so a blur fired while the row unmounts
  // (after Enter or Escape) cannot commit a second time or undo a cancel.
  const hpEditRef = useRef<string | null>(null);
  const [hpCur, setHpCur] = useState('');
  const [hpMax, setHpMax] = useState('');
  const [editName, setEditName] = useState(false);
  const [nameVal, setNameVal] = useState('');
  const [hpEdit, setHpEdit] = useState(false);
  const tokens = (scene?.tokens ?? []).filter(t => role === 'dm' || !t.hidden);
  const isDm = role === 'dm';
  const players = scene?.players ?? [];
  // Locate this player's own token, bound to their stable browser session id.
  const mySessionId = getMySessionId();
  const myToken: PlayerToken | undefined = scene?.players.find(p => p.sessionId === mySessionId);
  const avatarRef = useRef<HTMLInputElement>(null);
  const avatarUploadGeneration = useRef(0);
  const avatarUploadTarget = useRef<string | null>(null);
  const avatarPreviewCleanup = useRef<(() => void) | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  useEffect(() => () => { avatarPreviewCleanup.current?.(); }, []);
  useEffect(() => () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  // Once the R2-backed URL is reflected by the optimistic/authoritative scene,
  // discard the local object URL. Until then the picker looks immediate even
  // though the image bytes still need to upload securely.
  useEffect(() => {
    if (avatarPreview && avatarUploadTarget.current && myToken?.avatar === avatarUploadTarget.current) {
      avatarUploadTarget.current = null;
      setAvatarPreview(null);
    }
  }, [avatarPreview, myToken?.avatar]);

  const onAvatarPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !myToken) return;
    const uploadGeneration = ++avatarUploadGeneration.current;
    avatarUploadTarget.current = null;
    avatarPreviewCleanup.current?.();
    const localUrl = URL.createObjectURL(file);
    setAvatarPreview(localUrl);
    avatarPreviewCleanup.current = connection.previewOps([{ op: 'updatePlayer', tokenId: myToken.id, patch: { avatar: localUrl } }]);
    try {
      const url = await uploadImage(file, 'token');
      if (uploadGeneration !== avatarUploadGeneration.current) return;
      avatarUploadTarget.current = url;
      avatarPreviewCleanup.current?.();
      avatarPreviewCleanup.current = null;
      connection.sendOps([{ op: 'updatePlayer', tokenId: myToken.id, patch: { avatar: url } }]);
    } catch {
      if (uploadGeneration === avatarUploadGeneration.current) {
        avatarUploadTarget.current = null;
        avatarPreviewCleanup.current?.();
        avatarPreviewCleanup.current = null;
        setAvatarPreview(null);
      }
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
    hpEditRef.current = t.id;
    setHpEditId(t.id);
    setHpCur(t.hp ? String(t.hp.current) : '');
    setHpMax(t.hp ? String(t.hp.max) : '');
  };

  const commitHp = (t: Token) => {
    if (hpEditRef.current !== t.id) return;
    hpEditRef.current = null;
    // An empty maximum keeps the old one, or takes the typed value for a token without HP.
    const typedMax = hpMax.trim() ? Number(hpMax) : undefined;
    const cur = resolveHpInput(hpCur, t.hp?.current, typedMax ?? t.hp?.max ?? Number.MAX_SAFE_INTEGER);
    const max = typedMax ?? t.hp?.max ?? cur;
    if (cur !== null && max !== null && Number.isSafeInteger(max) && max > 0) {
      const hp = { current: cur, max };
      connection.sendOps([t.kind === 'player'
        ? { op: 'updatePlayer', tokenId: t.id, patch: { hp } }
        : { op: 'updateToken', tokenId: t.id, patch: { hp } }]);
    }
    setHpEditId(null);
    setHpCur('');
    setHpMax('');
  };

  const renderHpEditor = (t: Token) => {
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') commitHp(t);
      if (e.key === 'Escape') { hpEditRef.current = null; setHpEditId(null); }
    };
    // Commit only when focus leaves both fields; moving from 当前 to
    // 最大 must keep the row open so the maximum can be edited.
    return (
      <div key={t.id} className="flex items-center gap-1 px-3 py-1.5 border-b border-line bg-well"
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commitHp(t); }}>
        <span className="flex-1 truncate text-ink">{t.name}{t.number != null ? ` #${t.number}` : ''}</span>
        <span className="text-[10px] text-faint shrink-0">HP</span>
        <input
          autoFocus
          value={hpCur}
          onChange={e => setHpCur(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="当前/±"
          title="输入数字直接设定；-7 扣血，+5 治疗"
          aria-label={`${t.name} 当前 HP`}
          className="field-sm w-12 text-center tabular-nums"
        />
        <span className="text-faint text-xs">/</span>
        <input
          value={hpMax}
          onChange={e => setHpMax(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="最大"
          aria-label={`${t.name} 最大 HP`}
          className="field-sm w-9 text-center tabular-nums"
        />
      </div>
    );
  };

  return (
    <aside id="campaign-encounter" className="campaign-encounter-panel" aria-label="当前遭遇">
      {role === 'player' && myToken && (
        <div className="px-3 py-2.5 border-b border-line">
          <div className="panel-label mb-1.5">我的角色</div>
          <div className="flex items-center gap-1.5">
            {editName ? (
              <input autoFocus value={nameVal} onChange={e => setNameVal(e.target.value)}
                onBlur={() => { if (nameVal.trim()) connection.sendOps([{ op: 'updatePlayer', tokenId: myToken.id, patch: { name: nameVal.trim().slice(0, 80) } }]); setEditName(false); }}
                onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                className="field-sm flex-1 min-w-0" />
            ) : (
              <button className="flex-1 min-w-0 text-left truncate font-medium text-ink"
                onClick={() => { setNameVal(myToken.name); setEditName(true); }}>{myToken.name} ✎</button>
            )}
            <span className="shrink-0 text-[10px] text-faint">HP</span>
            {hpEdit ? (
              <input autoFocus value={hpCur} onChange={e => setHpCur(e.target.value)} title="输入数字直接设定；-7 扣血，+5 治疗"
                onBlur={() => {
                  const max = myToken.hp?.max;
                  const current = resolveHpInput(hpCur, myToken.hp?.current, max ?? Number.MAX_SAFE_INTEGER);
                  if (current !== null) connection.sendOps([{ op: 'updatePlayer', tokenId: myToken.id, patch: { hp: { current, max: max ?? current } } }]);
                  setHpEdit(false);
                }}
                onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                className="field-sm w-12 text-center tabular-nums" />
            ) : (
              <button className="shrink-0 text-xs font-medium tabular-nums text-ink" onClick={() => { setHpCur(String(myToken.hp?.current ?? '')); setHpMax(String(myToken.hp?.max ?? '')); setHpEdit(true); }}>
                {myToken.hp ? `${myToken.hp.current}/${myToken.hp.max}` : '—'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            {PALETTE.map(c => (
              <button key={c} onClick={() => connection.sendOps([{ op: 'updatePlayer', tokenId: myToken.id, patch: { color: c } }])}
                aria-label={`选择颜色 ${c}`}
                className={`w-4 h-4 ${myToken.color === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-panel' : ''}`} style={{ background: c }} />
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            {avatarPreview || myToken.avatar ? (
              <img src={avatarPreview ?? myToken.avatar} alt="" className="w-9 h-9 object-cover border border-line shrink-0" />
            ) : (
              <span className="w-9 h-9 shrink-0 border border-line" style={{ background: myToken.color }} />
            )}
            <button onClick={() => avatarRef.current?.click()}
              className="btn-xs">上传头像</button>
            {(avatarPreview || myToken.avatar) && (
              <button onClick={() => {
                avatarUploadGeneration.current += 1;
                avatarUploadTarget.current = null;
                avatarPreviewCleanup.current?.();
                avatarPreviewCleanup.current = null;
                setAvatarPreview(null);
                connection.sendOps([{ op: 'updatePlayer', tokenId: myToken.id, patch: { avatar: '' } }]);
              }}
                className="btn-xs text-accent hover:border-accent hover:text-accent">移除</button>
            )}
            <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={onAvatarPicked} />
          </div>
          <div className="text-[10px] text-faint mt-1.5">拖动棋子移动</div>
        </div>
      )}
      <div className="campaign-query-heading">
        <span className="panel-label">遭遇 <span className="tabular-nums">({tokens.length})</span></span>

      </div>
      {detail ? (
        <DetailDrawer entry={detail} onBack={() => setDetail(null)} />
      ) : (
        <div className="flex-1 overflow-y-auto">
          {isDm && players.length > 0 && <>
            <div className="px-3 py-1.5 panel-label bg-well border-b border-line">玩家角色 <span className="tabular-nums">({players.length})</span></div>
            {players.map(p => hpEditId === p.id ? renderHpEditor(p) : (
              <div key={p.id} className="flex items-center gap-1.5 px-3 py-1.5 border-b border-line hover:bg-well transition-colors duration-150">
                <span className="w-2 h-2 shrink-0" style={{ background: p.color }} aria-hidden="true" />
                <span className="flex-1 truncate text-ink">{p.name}</span>
                <button onClick={() => startHpEdit(p)} title="修改 HP"
                  className={`shrink-0 px-1 py-0.5 text-xs font-medium tabular-nums hover:bg-panel ${!p.hp ? 'text-faint' : p.hp.current <= 0 ? 'text-accent' : 'text-ink'}`}>
                  {p.hp ? `${p.hp.current}/${p.hp.max}` : 'HP:—'}
                </button>
              </div>
            ))}
            <div className="px-3 py-1.5 panel-label bg-well border-b border-line">敌人</div>
          </>}
          {tokens.map(t => {
            const eid = t.entryId;
            if (addingId === t.id) {
              return (
                <div key={t.id} className="flex items-center gap-1 px-3 py-1.5 border-b border-line bg-well">
                  <span className="flex-1 truncate text-ink">{t.name}{t.number != null ? ` #${t.number}` : ''}</span>
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
                    className="field-sm w-14 text-center tabular-nums"
                  />
                </div>
              );
            }
            if (hpEditId === t.id) return renderHpEditor(t);
            return (
              <div key={t.id} className="group flex items-center gap-1 px-3 py-1.5 border-b border-line hover:bg-well transition-colors duration-150">
                <span className="flex-1 truncate text-ink">{t.name}{t.number != null ? ` #${t.number}` : ''}</span>
                {isDm && <button className="btn-xs shrink-0" title={t.hidden ? '向玩家显示此Token' : '对玩家隐藏此Token'}
                  onClick={() => connection.sendOps([{ op: 'updateToken', tokenId: t.id, patch: { hidden: !t.hidden } }])}>
                  {t.hidden ? '显示' : '隐藏'}
                </button>}
                {isDm ? (
                <button
                  onClick={() => startHpEdit(t)}
                  title="修改 HP"
                  className={`shrink-0 px-1 py-0.5 text-xs font-medium tabular-nums hover:bg-panel ${
                    !t.hp ? 'text-faint' : t.hp.current <= 0 ? 'text-accent' : 'text-ink'
                  }`}
                >{t.hp ? `${t.hp.current}/${t.hp.max}` : 'HP:—'}</button>
                ) : <span className="shrink-0 px-1 text-xs tabular-nums">{t.hp ? `${t.hp.current}/${t.hp.max}` : 'HP:—'}</span>}
                {eid && (
                  <button
                    onClick={() => setDetail({ type: 'monster', id: eid, nameZh: t.name })}
                    title="显示详细数据"
                    className="shrink-0 h-6 px-1 inline-flex items-center text-xs text-faint hover:text-ink hover:bg-panel transition-colors duration-150"
                  >数据</button>
                )}
                {isDm && !inInitiative(t.id) && (
                  <button
                    onClick={() => startAdd(t)}
                    title="加入先攻"
                    className="shrink-0 h-6 px-1 inline-flex items-center text-xs text-faint group-hover:text-ink hover:bg-panel transition-colors duration-150"
                  >先攻</button>
                )}
                {isDm && inInitiative(t.id) && (
                  <span title="已在先攻列表" className="shrink-0 px-1 text-[10px] font-bold text-accent">已入</span>
                )}
                {isDm && (
                  <ConfirmButton
                    onConfirm={() => connection.sendOps([{ op: 'removeToken', tokenId: t.id }])}
                    title="移除棋子"
                    confirmLabel="移除？"
                    className="shrink-0 h-6 px-1 inline-flex items-center text-xs text-faint hover:text-accent hover:bg-panel transition-colors duration-150"
                  >✕</ConfirmButton>
                )}
              </div>
            );
          })}
          {tokens.length === 0 && <div className="p-3 text-muted text-xs">暂无敌人</div>}
        </div>
      )}
    </aside>
  );
}
