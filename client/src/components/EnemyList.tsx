import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
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
import { subscribeEncounterReference } from '../features/encounter/navigation';
import { conditionDefinition } from '../features/conditions/model';
import { useBoardCommands } from '../features/history/BoardCommandContext';

// Player token color choices (same palette the DM sees when placing a player).
const PALETTE = ['#e53e3e', '#38a169', '#3182ce', '#d69e2e', '#805ad5', '#dd6b20', '#319795', '#d53f8c'];

interface Props {
  selectedTokenId?: string | null;
}

// Left-hand encounter panel listing monster and NPC tokens with the same HP,
// details, deletion, and initiative controls.
export default function EnemyList({ selectedTokenId }: Props) {
  const { scene, campaign, encounter, role, viewer } = useScene();
  const { performOps } = useBoardCommands();
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
  const [aliasEditingId, setAliasEditingId] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState('');
  const [rollingInitiative, setRollingInitiative] = useState(false);
  const [initiativeMessage, setInitiativeMessage] = useState<string | null>(null);
  const [combatSelection, setCombatSelection] = useState<string[]>([]);
  const tokens = useMemo(() => encounterTokens(scene?.tokens ?? []), [scene?.tokens]);
  const highlightedTokenId = selectedEncounterTokenId(tokens, selectedTokenId);
  const monsterTokens = tokens.filter(token => token.kind === 'monster');
  const npcs = campaign?.npcs ?? [];
  const detailNpc = detail?.kind === 'npc' ? detail.npc : null;
  const isDm = role === 'dm';
  const canReadPrivate = isDm || viewer?.canReadAll === true;
  const initiativeTokenIds = useMemo(() => new Set(
    encounter?.status === 'ended'
      ? []
      : (encounter?.combatants ?? []).flatMap(entry => entry.tokenId ? [entry.tokenId] : []),
  ), [encounter]);
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

  useEffect(() => subscribeEncounterReference(tokenId => {
    const target = tokens.find(token => token.id === tokenId);
    if (!target) return;
    if (target.kind === 'monster' && target.entryId) {
      setDetail({ kind: 'monster', id: target.entryId, nameZh: target.name });
      return;
    }
    const quickReference = npcQuickReferenceForToken(target, npcs, { allowFallback: canReadPrivate });
    if (quickReference) setDetail({ kind: 'npc', npc: quickReference });
  }), [tokens, npcs, canReadPrivate]);

  // Combat selection is deliberately local and independent from board object
  // selection. Prune it when switching scenes, deleting a Token, or after the
  // selected Token has joined the Encounter.
  useEffect(() => {
    const selectable = new Set(tokens.flatMap(token => initiativeTokenIds.has(token.id) ? [] : [token.id]));
    setCombatSelection(current => {
      const next = current.filter(tokenId => selectable.has(tokenId));
      return next.length === current.length ? current : next;
    });
  }, [scene?.id, tokens, initiativeTokenIds]);

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
      performOps('更新角色头像', [{ op: 'updatePlayer', tokenId: myToken.id, patch: { avatar: url } }]);
    } catch {
      if (uploadGeneration === avatarUploadGeneration.current) {
        avatarUploadTarget.current = null;
        avatarPreviewCleanup.current?.();
        avatarPreviewCleanup.current = null;
        setAvatarPreview(null);
      }
    }
  };

  const inInitiative = (tokenId: string) => initiativeTokenIds.has(tokenId);

  const toggleCombatSelection = (tokenId: string) => {
    if (initiativeTokenIds.has(tokenId)) return;
    setCombatSelection(current => current.includes(tokenId)
      ? current.filter(id => id !== tokenId)
      : [...current, tokenId]);
  };

  const startAdd = (t: Token) => {
    setAddingId(t.id);
    setAddValue('');
  };

  const commitAdd = (t: Token) => {
    if (!addValue.trim()) {
      setAddingId(null);
      return;
    }
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
    if (rollingInitiative || combatSelection.length === 0) return;
    setRollingInitiative(true);
    setInitiativeMessage(null);
    try {
      const result = await api.rollInitiative(combatSelection);
      const rolledIds = new Set(result.rolls.map(roll => roll.tokenId));
      setCombatSelection(current => current.filter(tokenId => !rolledIds.has(tokenId)));
      setInitiativeMessage(result.rolls.length > 0
        ? `已将 ${result.rolls.length} 个选中单位加入战斗并自动先攻`
        : '没有可加入战斗的选中单位');
    } catch (error) {
      setInitiativeMessage(error instanceof Error ? error.message : '自动先攻失败，请重试');
    } finally {
      setRollingInitiative(false);
    }
  };

  return (
    <aside className="relative flex h-full w-full flex-col border-r border-zinc-700/60 bg-zinc-900 text-sm">
      {role === 'player' && myToken && (
        <div className="px-2 py-2 border-b border-zinc-800 bg-zinc-800/30">
          <div className="text-xs text-zinc-400 mb-1">我的角色</div>
          <div className="flex items-center gap-1.5">
            {editName ? (
              <input autoFocus value={nameVal} onChange={e => setNameVal(e.target.value)}
                onBlur={() => { if (nameVal.trim()) performOps('修改角色名称', [{ op: 'updatePlayer', tokenId: myToken.id, patch: { name: nameVal.trim().slice(0, 20) } }]); setEditName(false); }}
                onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                className="flex-1 min-w-0 bg-zinc-900 rounded px-1 py-0.5 text-sm" />
            ) : (
              <button className="flex-1 min-w-0 text-left truncate text-zinc-100" title="编辑自己的角色名称"
                onClick={() => { setNameVal(myToken.name); setEditName(true); }}>{myToken.name} ✎</button>
            )}
            <span className="shrink-0 text-[10px] text-zinc-500">HP</span>
            {hpEdit ? (
              <input autoFocus value={hpCur} onChange={e => setHpCur(e.target.value)}
                onBlur={() => { const c = Number(hpCur), m = Number(hpMax); if (Number.isFinite(c) && Number.isFinite(m)) performOps('修改角色 HP', [{ op: 'updatePlayer', tokenId: myToken.id, patch: { hp: { current: c, max: m } } }]); setHpEdit(false); }}
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
              <button key={c} onClick={() => performOps('修改角色颜色', [{ op: 'updatePlayer', tokenId: myToken.id, patch: { color: c } }])}
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
                performOps('移除角色头像', [{ op: 'updatePlayer', tokenId: myToken.id, patch: { avatar: '' } }]);
              }}
                className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-500 hover:text-red-400 text-xs">移除</button>
            )}
            <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={onAvatarPicked} />
          </div>
          <div className="text-[10px] text-zinc-600 mt-1">拖动画布上的 token 可移动位置</div>
        </div>
      )}
      <div className="border-b border-zinc-800 px-2 py-2 text-xs text-zinc-400">
        <div className="flex items-center justify-between gap-1">
          <span>敌人 / NPC <span className="text-zinc-500">({tokens.length})</span></span>
          {isDm && <span className={combatSelection.length ? 'text-sky-300' : 'text-zinc-600'}>已选 {combatSelection.length}</span>}
        </div>
        {isDm && (
          <div className="mt-1.5 flex items-center gap-1">
            <button
              onClick={() => void rollInitiative()}
              disabled={rollingInitiative || combatSelection.length === 0}
              title="只将勾选的敌人和 NPC 加入当前战斗，并掷 d20+敏捷调整值"
              className="min-w-0 flex-1 rounded bg-amber-600/20 px-1.5 py-1 text-[10px] text-amber-400 hover:bg-amber-600/30 disabled:cursor-not-allowed disabled:opacity-40"
            >{rollingInitiative ? '掷骰中…' : `选中自动先攻${combatSelection.length ? ` (${combatSelection.length})` : ''}`}</button>
            {combatSelection.length > 0 && (
              <button type="button" onClick={() => setCombatSelection([])}
                className="shrink-0 rounded px-1.5 py-1 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">清空</button>
            )}
          </div>
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
        <NpcEncounterDrawer npc={detailNpc} records={npcs} readOnly={!canReadPrivate} onBack={() => setDetail(null)} />
      ) : (
        <div className="flex-1 overflow-y-auto">
          {tokens.map(t => {
            const eid = t.entryId;
            const highlighted = highlightedTokenId === t.id;
            const combatSelected = combatSelection.includes(t.id);
            const rowClassName = highlighted
              ? 'relative bg-amber-400/10 ring-2 ring-inset ring-amber-400 shadow-[inset_0_0_18px_rgba(251,191,36,0.12)]'
              : combatSelected
                ? 'bg-sky-500/10 ring-1 ring-inset ring-sky-500/60'
                : t.hidden
                  ? 'bg-violet-950/15 opacity-75 hover:opacity-100'
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
            const quickReferenceNpc = npcQuickReferenceForToken(t, npcs, { allowFallback: canReadPrivate });
            return (
              <div
                key={t.id}
                ref={highlighted ? highlightedRowRef : undefined}
                data-token-selected={highlighted ? 'true' : undefined}
                className={`border-b border-zinc-800/50 px-2 py-1.5 ${rowClassName}`}
              >
                <div className="flex items-center gap-1">
                  {isDm && (
                    <input
                      type="checkbox"
                      checked={combatSelected}
                      disabled={inInitiative(t.id)}
                      onChange={() => toggleCombatSelection(t.id)}
                      aria-label={`选择 ${label} 加入战斗`}
                      title={inInitiative(t.id) ? '已在当前战斗中' : '勾选后可批量加入战斗并自动先攻'}
                      className="h-3.5 w-3.5 shrink-0 accent-sky-500 disabled:cursor-not-allowed disabled:opacity-30"
                    />
                  )}
                  <span className="flex-1 truncate text-zinc-200">{label}</span>
                  {t.kind === 'monster' && eid && (
                    <button
                      onClick={() => setDetail({ kind: 'monster', id: eid, nameZh: t.name })}
                      title="显示详细数据"
                      aria-label={`速查 ${label} 的怪物数据`}
                      className="shrink-0 w-6 h-6 rounded hover:bg-zinc-700 text-zinc-400 hover:text-amber-400"
                    >📖</button>
                  )}
                  {quickReferenceNpc && (
                    <button
                      onClick={() => setDetail({ kind: 'npc', npc: quickReferenceNpc })}
                      title="速查 NPC 数据"
                      aria-label={`速查 ${label} 的 NPC 数据`}
                      className="shrink-0 w-6 h-6 rounded hover:bg-zinc-700 text-zinc-400 hover:text-amber-400"
                    >📖</button>
                  )}
                  {isDm && !inInitiative(t.id) && (
                    <button
                      onClick={() => startAdd(t)}
                      title="手动输入先攻并加入战斗"
                      className="shrink-0 px-1 py-0.5 rounded hover:bg-emerald-700/30 text-emerald-400 text-xs"
                    >先攻</button>
                  )}
                  {isDm && inInitiative(t.id) && (
                    <span title="已在先攻列表" className="shrink-0 px-1 py-0.5 text-[10px] text-emerald-600">已入</span>
                  )}
                  {isDm && (
                    <button
                      onClick={() => performOps(`删除 ${label} Token`, [{ op: 'removeToken', tokenId: t.id }])}
                      title="删除 token"
                      aria-label={`删除地图 Token ${label}`}
                      className="shrink-0 w-6 h-6 rounded hover:bg-zinc-700 text-zinc-400 hover:text-red-400"
                    >✕</button>
                  )}
                </div>
                {isDm && (
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                    <button
                      type="button"
                      onClick={() => performOps('切换 Token 可见性', [{ op: 'updateToken', tokenId: t.id, patch: { hidden: !t.hidden } }])}
                      title={t.hidden ? '让玩家看到这个 Token' : '从玩家地图和玩家端列表隐藏'}
                      className={`rounded px-1.5 py-0.5 ${t.hidden ? 'bg-violet-500/20 text-violet-300' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
                    >{t.hidden ? '仅主持人' : '玩家可见'}</button>
                    <button
                      type="button"
                      onClick={() => {
                        const current = t.hpVisibility ?? 'value';
                        const hpVisibility = current === 'value' ? 'bar' : current === 'bar' ? 'none' : 'value';
                        performOps('切换 HP 可见性', [{ op: 'updateToken', tokenId: t.id, patch: { hpVisibility } }]);
                      }}
                      title="切换玩家可见的生命值信息"
                      className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400 hover:text-zinc-200"
                    >HP：{t.hpVisibility === 'none' ? '隐藏' : t.hpVisibility === 'bar' ? '仅血条' : '数值'}</button>
                    {aliasEditingId === t.id ? (
                      <span className="flex min-w-0 flex-1 items-center gap-1">
                        <input
                          autoFocus
                          aria-label={`${label} 玩家称谓`}
                          value={aliasDraft}
                          onChange={event => setAliasDraft(event.target.value)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') {
                              performOps('修改玩家称谓', [{ op: 'updateToken', tokenId: t.id, patch: { publicName: aliasDraft.trim().slice(0, 120) } }]);
                              setAliasEditingId(null);
                            }
                            if (event.key === 'Escape') setAliasEditingId(null);
                          }}
                          placeholder="留空显示真实名称"
                          className="min-w-0 flex-1 rounded bg-zinc-950 px-1.5 py-0.5 text-zinc-200 outline-none ring-1 ring-zinc-700 focus:ring-amber-500"
                        />
                        <button type="button" onClick={() => {
                          performOps('修改玩家称谓', [{ op: 'updateToken', tokenId: t.id, patch: { publicName: aliasDraft.trim().slice(0, 120) } }]);
                          setAliasEditingId(null);
                        }} className="rounded bg-amber-600/20 px-1.5 py-0.5 text-amber-400">保存</button>
                        <button type="button" onClick={() => setAliasEditingId(null)} className="rounded px-1 py-0.5 text-zinc-500">取消</button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setAliasDraft(t.publicName ?? ''); setAliasEditingId(t.id); }}
                        title="设置玩家称谓，隐藏真实姓名与怪物手册链接"
                        className="max-w-full truncate rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400 hover:text-zinc-200"
                      >称谓：{t.publicName?.trim() || '真实名称'}</button>
                    )}
                  </div>
                )}
                {(t.conditions?.length ?? 0) > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {t.conditions?.map(condition => {
                      const definition = conditionDefinition(condition.id);
                      return (
                        <span key={condition.id} className="rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-[9px] text-zinc-300"
                          title={definition.label}>
                          {definition.label}{condition.remainingRounds !== null ? ` ${condition.remainingRounds}` : ''}
                        </span>
                      );
                    })}
                  </div>
                )}
                <EnemyHitPoints
                  label={label}
                  hp={t.hp}
                  hpRatio={t.hpRatio}
                  visibility={t.hpVisibility}
                  editable={isDm}
                  onCommit={hp => performOps('修改 Token HP', [{ op: 'updateToken', tokenId: t.id, patch: { hp } }])}
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
