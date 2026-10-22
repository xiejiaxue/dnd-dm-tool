import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { connection, useScene } from '../ws';
import { batchInitiative, initiativeTokens, initiativeFromEntry, parseInitiativeBonus, tokenLabel } from '../initiative-batch';

export default function BatchInitiative({ onClose, enemyIds }: { onClose: () => void; enemyIds?: readonly string[] }) {
  const { scene, role } = useScene();
  const dialog = useRef<HTMLDialogElement>(null);
  const [bonuses, setBonuses] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const busy = useRef(false);
  const sceneId = useRef(scene?.id);
  // Freeze the scope when opened so unrelated scene updates cannot add candidates.
  const scope = useRef(enemyIds === undefined ? undefined : [...enemyIds]);
  const tokens = scene ? initiativeTokens(scene, scope.current) : [];
  const entered = new Set(scene?.initiative.map(e => e.tokenId));
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  useEffect(() => {
    if (scene?.id !== sceneId.current || role !== 'dm') onClose();
  }, [scene?.id, role, onClose]);
  useEffect(() => {
    if (!scene) return;
    let cancelled = false;
    const initial = initiativeTokens(scene, scope.current);
    setChosen(new Set(initial.filter(t => t.kind === 'monster' && !entered.has(t.id)).map(t => t.id)));
    const cache = new Map<string, Promise<ReturnType<typeof initiativeFromEntry>>>();
    const queue = [...initial];
    void Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length && !cancelled) {
        const token = queue.shift()!;
        let result = token.initiativeBonus == null ? null : { bonus: token.initiativeBonus, source: '已保存' };
        if (!result && token.entryId && token.kind === 'monster') {
          let request = cache.get(token.entryId);
          if (!request) { request = api.entry('monster', token.entryId).then(initiativeFromEntry).catch(() => null); cache.set(token.entryId, request); }
          result = await request;
        }
        if (!cancelled) {
          setBonuses(old => token.id in old ? old : { ...old, [token.id]: result ? String(result.bonus) : '' });
          setSources(old => ({ ...old, [token.id]: result?.source ?? '请填写加值' }));
        }
      }
    })).then(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Capture the opening scene. Subsequent scene updates must not erase edits.
  }, []);
  const available = tokens.filter(t => !entered.has(t.id));
  const candidates = available.filter(t => chosen.has(t.id));
  const allSelected = available.length > 0 && candidates.length === available.length;
  const invalid = candidates.some(t => parseInitiativeBonus(bonuses[t.id] ?? '') === null);
  const roll = () => {
    const live = connection.lastState;
    if (busy.current || !connection.connected || live?.role !== 'dm' || live.scene.id !== sceneId.current || invalid) return;
    busy.current = true;
    const allowed = new Set(initiativeTokens(live.scene, scope.current).map(t => t.id));
    const batch = batchInitiative(live.scene, new Map(candidates.filter(t => allowed.has(t.id)).map(t => [t.id, parseInitiativeBonus(bonuses[t.id])!])));
    // The room protocol accepts at most 20 operations per command.
    for (let i = 0; i < batch.ops.length; i += 20) connection.sendOps(batch.ops.slice(i, i + 20));
    busy.current = false;
    onClose();
  };
  return <dialog ref={dialog} onCancel={onClose} className="rounded-lg border border-line bg-panel text-ink p-5 w-[min(680px,94vw)] max-h-[85vh] overflow-y-auto backdrop:bg-black/40" aria-labelledby="batch-initiative-title">
    <div className="flex items-center justify-between mb-3"><h2 id="batch-initiative-title" className="font-bold">{scope.current === undefined ? '批量先攻' : '选中敌人的先攻'}</h2><button onClick={onClose} aria-label="关闭批量先攻" className="btn-xs">关闭</button></div>
    <p className="text-xs text-muted mb-3">每个勾选的 Token 单独掷 d20，加上对应加值。敏捷计算未包含额外特性，可手动修改；玩家角色请填写加值。已在先攻表中的 Token 自动跳过。</p>
    {scope.current !== undefined && <p className="text-xs text-muted mb-3">仅列出本次框选的敌人。未选中的敌人及玩家角色不参与；不会改变 Token 的显示或隐藏状态。</p>}
    {loading && <p role="status" className="text-xs mb-2">正在读取数据卡…</p>}
    <div className="flex items-center gap-3 mb-3">
      <button className="btn-xs" disabled={!available.length} onClick={() => setChosen(allSelected ? new Set() : new Set(available.map(t => t.id)))}>{allSelected ? '取消全选' : '全选'}</button>
      <span className="text-xs text-muted">已选 {candidates.length} / {available.length}</span>
    </div>
    <table className="w-full text-sm"><thead><tr className="border-b border-line text-left"><th>选择</th><th>Token</th><th>先攻加值</th><th>来源</th></tr></thead><tbody>
      {tokens.map(t => <tr key={t.id} className="border-b border-line"><td className="py-2"><input type="checkbox" aria-label={`选择 ${tokenLabel(t)}`} checked={chosen.has(t.id) && !entered.has(t.id)} disabled={entered.has(t.id)} onChange={e => setChosen(old => { const next = new Set(old); if (e.target.checked) next.add(t.id); else next.delete(t.id); return next; })} /></td><td>{tokenLabel(t)}{entered.has(t.id) && <span className="text-xs text-muted"> · 已加入</span>}</td><td><input aria-label={`${tokenLabel(t)} 先攻加值`} className="field-sm w-16 my-1" inputMode="numeric" placeholder="待填" value={bonuses[t.id] ?? ''} disabled={entered.has(t.id)} onChange={e => { setBonuses(old => ({ ...old, [t.id]: e.target.value })); setSources(old => ({ ...old, [t.id]: '手动调整' })); }} /></td><td className="text-xs text-muted">{sources[t.id] ?? '等待数据'}</td></tr>)}
    </tbody></table>
    {!tokens.length && <p className="py-4 text-muted">场景中还没有 Token。</p>}
    <div className="mt-4 flex gap-3 items-center"><button onClick={roll} disabled={loading || invalid || !candidates.length || !connection.connected} className="btn-primary">掷先攻并加入（{candidates.length}）</button>{invalid && <span className="text-xs text-accent">请填写勾选项的加值（−50 至 +50 的整数）。</span>}</div>
  </dialog>;
}
