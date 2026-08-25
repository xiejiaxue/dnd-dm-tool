import { useState } from 'react';
import type { Token } from '../../types';
import { hitPointPercentage, parseHitPointDraft, type HitPoints } from './model';

interface Props {
  label: string;
  hp: Token['hp'];
  editable: boolean;
  onCommit: (hp: HitPoints) => void;
}

export default function EnemyHitPoints({ label, hp, editable, onCommit }: Props) {
  const [editing, setEditing] = useState(false);
  const [currentDraft, setCurrentDraft] = useState('');
  const [maxDraft, setMaxDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const startEditing = () => {
    if (!editable) return;
    setCurrentDraft(hp ? String(hp.current) : '');
    setMaxDraft(hp ? String(hp.max) : '');
    setError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setError(null);
  };

  if (editing) {
    return (
      <form
        className="mt-1.5 rounded bg-zinc-950/70 p-1.5"
        onSubmit={event => {
          event.preventDefault();
          const result = parseHitPointDraft(currentDraft, maxDraft);
          if (!result.hp) {
            setError(result.error);
            return;
          }
          onCommit(result.hp);
          setEditing(false);
          setError(null);
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelEditing();
          }
        }}
      >
        <div className="grid grid-cols-2 gap-1.5">
          <label className="text-[10px] text-zinc-400">
            <span className="block mb-0.5">当前 HP</span>
            <input
              autoFocus
              aria-label={`${label} 当前 HP`}
              inputMode="numeric"
              min={0}
              step={1}
              type="number"
              value={currentDraft}
              onChange={event => { setCurrentDraft(event.target.value); setError(null); }}
              className="w-full rounded bg-zinc-900 px-1.5 py-1 text-center text-xs text-zinc-100 outline-none focus:ring-1 focus:ring-amber-500"
            />
          </label>
          <label className="text-[10px] text-zinc-400">
            <span className="block mb-0.5">最大 HP</span>
            <input
              aria-label={`${label} 最大 HP`}
              inputMode="numeric"
              min={1}
              step={1}
              type="number"
              value={maxDraft}
              onChange={event => { setMaxDraft(event.target.value); setError(null); }}
              className="w-full rounded bg-zinc-900 px-1.5 py-1 text-center text-xs text-zinc-100 outline-none focus:ring-1 focus:ring-amber-500"
            />
          </label>
        </div>
        {error && <div role="alert" className="mt-1 text-[10px] leading-tight text-red-400">{error}</div>}
        <div className="mt-1.5 flex justify-end gap-1">
          <button type="button" onClick={cancelEditing} className="rounded px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800">取消</button>
          <button type="submit" className="rounded bg-amber-600/20 px-2 py-0.5 text-[10px] text-amber-400 hover:bg-amber-600/30">保存</button>
        </div>
      </form>
    );
  }

  const percentage = hitPointPercentage(hp);
  const currentTone = !hp ? 'text-zinc-500' : hp.current <= 0 ? 'text-red-400' : percentage <= 50 ? 'text-amber-400' : 'text-emerald-400';
  const content = (
    <>
      <span className="shrink-0 text-zinc-500">当前</span>
      <strong className={`shrink-0 tabular-nums ${currentTone}`}>{hp?.current ?? '—'}</strong>
      <span className="shrink-0 text-zinc-600">/</span>
      <span className="shrink-0 text-zinc-500">最大</span>
      <strong className="shrink-0 tabular-nums text-zinc-300">{hp?.max ?? '—'}</strong>
      <span className="ml-1 h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
        <span
          className={`block h-full rounded-full ${percentage <= 25 ? 'bg-red-500' : percentage <= 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${percentage}%` }}
        />
      </span>
      {editable && <span className="shrink-0 text-zinc-600">✎</span>}
    </>
  );

  return editable ? (
    <button
      type="button"
      aria-label={`编辑 ${label} 的生命值`}
      title="编辑当前 HP 和最大 HP"
      onClick={startEditing}
      className="mt-1 flex w-full items-center gap-1 rounded px-1 py-0.5 text-[10px] hover:bg-zinc-800"
    >{content}</button>
  ) : (
    <div aria-label={`${label} 的生命值`} className="mt-1 flex w-full items-center gap-1 px-1 py-0.5 text-[10px]">{content}</div>
  );
}
