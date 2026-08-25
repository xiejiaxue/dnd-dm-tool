import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api } from '../api';
import { connection, getMySessionId, useScene } from '../ws';
import { uploadImage } from '../upload';
import DetailDrawer from './DetailDrawer';
import type { PlayerToken, Token } from '../types';
import EnemyHitPoints from '../features/hit-points/EnemyHitPoints';
import { useMonsterHitPointHydration } from '../features/hit-points/useMonsterHitPointHydration';
import NpcEncounterDrawer from '../features/npc/NpcEncounterDrawer';
import { npcQuickReferenceForToken } from '../features/npc/token';
import { encounterTokens, selectedEncounterTokenId } from '../features/encounter/combatants';

// Player token color choices (same palette the DM sees when placing a player).
const PALETTE = ['#e53e3e', '#38a169', '#3182ce', '#d69e2e', '#805ad5', '#dd6b20', '#319795', '#d53f8c'];

interface Props {
  selectedTokenId?: string | null;
}

// Left-hand encounter panel listing monster and NPC tokens with the same HP,
// details, deletion, and initiative controls.
export default function EnemyList({ selectedTokenId }: Props) {
  const { scene, campaign, role } = useScene();
  const [detail, setDetail] = useState<
    | { kind: 'monster'; id: string; nameZh: string }
    | { kind: 'npc'; npc: NonNullable<ReturnType<typeof npcQuickReferenceForToken>> }
    | null
  >(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addValue, setAddValue] = useState('');
  const [hpCur, setHpCur] = useState('');
  const [hpMax, setHpMax] = useState('');
  const [editName, setEditName] = useState(false);
  const [nameVal, setNameVal] = useState('');
  const [hpEdit, setHpEdit] = useState(false);
  const [rollingInitiative, setRollingInitiative] = useState(false);
  const [initiativeMessage, setInitiativeMessage] = useState<string | null>(null);
  const tokens = encounterTokens(scene?.tokens ?? []);
  const highlightedTokenId = selectedEncounterTokenId(tokens, selectedTokenId);
  const monsterTokens = tokens.filter(token => token.kind === 'monster');
  const npcs = campaign?.npcs ?? [];
  const detailNpc = detail?.kind === 'npc' ? detail.npc : null;
  const isDm = role === 'dm';
  useMonsterHitPointHydration(scene?.id, monsterTokens, isDm);
  // Locate this player's own token, bound to their stable browser session id.
  const mySessionId = getMySessionId();
  const myToken: PlayerToken | undefined = scene?.players.find(p => p.sessionId === mySessionId);
  const avatarRef = useRef<HTMLInputElement>(null);
  const avatarUploadGeneration = useRef(0);
  const avatarUploadTarget = useRef<string | null>(null);
  const avatarPreviewCleanup = useRef<(() => void) | null>(null);
  const highlightedRowRef = useRef<HTMLDivElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  useEffect(() => () => { avatarPreviewCleanup.current?.(); }, []);
  useEffect(() => () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  // A board selection should reveal the corresponding encounter row even when
  // the user was viewing a stat drawer or had scrolled elsewhere in the list.
  useEffect(() => {
    if (highlightedTokenId && detail) setDetail(null);
  }, [highlightedTokenId]);
  useEffect(() => {
    if (!highlightedTokenId || detail) return;
    highlightedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [highlightedTokenId, detail, tokens.length]);

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

  const rollInitiative = async () => {
    if (rollingInitiative) return;
    setRollingInitiative(true);
    setInitiativeMessage(null);
    try {
      const result = await api.rollInitiative();
      setInitiativeMessage(result.rolls.length > 0
        ? `已为 ${result.rolls.length} 个战斗单位掷先攻`
        : '当前场景没有怪物或 NPC token');
    } catch (error) {
      setInitiativeMessage(error instanceof Error ? error.message : '自动先攻失败，请重试');
    } finally {
      setRollingInitiative(false);
    }
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
            {avatarPreview || myToken.avatar ? (
              <img src={avatarPreview ?? myToken.avatar} alt="" className="w-8 h-8 rounded-full object-cover bg-zinc-700 shrink-0" />
            ) : (
              <span className="w-8 h-8 rounded-full shrink-0" style={{ background: myToken.color }} />
            )}
            <button onClick={() => avatarRef.current?.click()}
              className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-xs">上传头像</button>
            {(avatarPreview || myToken.avatar) && (
              <button onClick={() => {
                avatarUploadGeneration.current += 1;
                avatarUploadTarget.current = null;
                avatarPreviewCleanup.current?.();
                avatarPreviewCleanup.current = null;
                setAvatarPreview(null);
                connection.sendOps([{ op: 'updatePlayer', tokenId: myToken.id, patch: { avatar: '' } }]);
              }}
                className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-500 hover:text-red-400 text-xs">移除</button>
            )}
            <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={onAvatarPicked} />
          </div>
          <div className="text-[10px] text-zinc-600 mt-1">拖动画布上的 token 可移动位置</div>
        </div>
      )}
      <div className="px-2 py-2 border-b border-zinc-800 text-xs text-zinc-400 flex items-center justify-between gap-1">
        <span>敌人 / NPC <span className="text-zinc-500">({tokens.length})</span></span>
        {isDm && (
          <button
            onClick={() => void rollInitiative()}
            disabled={rollingInitiative}
            title="对场景内所有怪物和 NPC 掷 d20+敏捷调整值，加入/重掷先攻"
            className="shrink-0 px-1.5 py-0.5 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 disabled:opacity-50 text-[10px]"
          >{rollingInitiative ? '掷骰中…' : '自动随机先攻'}</button>
        )}
      </div>
      {initiativeMessage && (
        <div className="px-2 py-1.5 border-b border-zinc-800 text-[10px] text-amber-300 bg-amber-950/20">
          {initiativeMessage}
        </div>
      )}
      {detail?.kind === 'monster' ? (
        <DetailDrawer entry={{ type: 'monster', id: detail.id, nameZh: detail.nameZh }} onBack={() => setDetail(null)} />
      ) : detailNpc ? (
        <NpcEncounterDrawer npc={detailNpc} records={npcs} onBack={() => setDetail(null)} />
      ) : (
        <div className="flex-1 overflow-y-auto">
          {tokens.map(t => {
            const eid = t.entryId;
            const highlighted = highlightedTokenId === t.id;
            const rowClassName = highlighted
              ? 'relative bg-amber-400/10 ring-2 ring-inset ring-amber-400 shadow-[inset_0_0_18px_rgba(251,191,36,0.12)]'
              : 'hover:bg-zinc-800/50';
            if (addingId === t.id) {
              return (
                <div
                  key={t.id}
                  ref={highlighted ? highlightedRowRef : undefined}
                  data-token-selected={highlighted ? 'true' : undefined}
                  className={`flex items-center gap-1 px-2 py-1.5 border-b border-zinc-800/50 ${rowClassName}`}
                >
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
            const label = `${t.name}${t.number != null ? ` #${t.number}` : ''}`;
            const quickReferenceNpc = npcQuickReferenceForToken(t, npcs);
            return (
              <div
                key={t.id}
                ref={highlighted ? highlightedRowRef : undefined}
                data-token-selected={highlighted ? 'true' : undefined}
                className={`border-b border-zinc-800/50 px-2 py-1.5 ${rowClassName}`}
              >
                <div className="flex items-center gap-1">
                  <span className="flex-1 truncate text-zinc-200">{label}</span>
                  {t.kind === 'monster' && eid && (
                    <button
                      onClick={() => setDetail({ kind: 'monster', id: eid, nameZh: t.name })}
                      title="显示详细数据"
                      className="shrink-0 w-6 h-6 rounded hover:bg-zinc-700 text-zinc-400 hover:text-amber-400"
                    >📖</button>
                  )}
                  {quickReferenceNpc && (
                    <button
                      onClick={() => setDetail({ kind: 'npc', npc: quickReferenceNpc })}
                      title="速查 NPC 数据"
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
                <EnemyHitPoints
                  label={label}
                  hp={t.hp}
                  editable={isDm}
                  onCommit={hp => connection.sendOps([{ op: 'updateToken', tokenId: t.id, patch: { hp } }])}
                />
              </div>
            );
          })}
          {tokens.length === 0 && <div className="p-3 text-zinc-500 text-xs">暂无敌人或 NPC token</div>}
        </div>
      )}
    </aside>
  );
}
