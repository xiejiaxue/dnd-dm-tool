import { useEffect, useRef, useState } from 'react';
import {
  DICE_SIDES,
  adjustDice,
  diceCount,
  emptyDicePool,
  formatDicePool,
  type DieSides,
  type DiceRollResult,
} from './model';
import { useActionLog } from '../action-log/ActionLogContext';
import { useTabletopSettings } from '../settings/TabletopSettingsContext';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface RollHistoryEntry extends DiceRollResult {
  id: number;
}

const MAX_HISTORY = 5;

export default function DiceTray({ open, onClose }: Props) {
  const { roll: logRoll } = useActionLog();
  const { settings } = useTabletopSettings();
  const [pool, setPool] = useState(emptyDicePool);
  const [history, setHistory] = useState<RollHistoryEntry[]>([]);
  const nextHistoryId = useRef(1);
  const count = diceCount(pool);
  const formula = formatDicePool(pool);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Treat the tray as the topmost transient surface. Without capture and
      // immediate propagation stop, BoardCanvas also consumes Escape and
      // unexpectedly clears the current Token selection.
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [open, onClose]);

  if (!open) return null;

  const change = (sides: DieSides, delta: number) => {
    setPool(current => adjustDice(current, sides, delta));
  };

  const roll = async () => {
    if (!formula) return;
    try {
      const result = await logRoll({ label: '自由掷骰', formula, visibility: settings.defaultRollMode });
      setHistory(current => [{
        id: nextHistoryId.current++, formula: result.formula, total: result.total,
        groups: result.groups.map(group => ({ sides: group.sides as DieSides, results: group.rolls, subtotal: group.subtotal })),
      }, ...current].slice(0, MAX_HISTORY));
      setPool(emptyDicePool());
    } catch { /* Action log surfaces transport errors elsewhere; keep the pool. */ }
  };

  return (
    <section
      aria-label="掷骰板"
      className="absolute bottom-3 left-3 z-30 w-[min(26rem,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-zinc-600/80 bg-zinc-900/95 shadow-2xl backdrop-blur"
    >
      <header className="flex items-center border-b border-zinc-700/70 px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">掷骰板</h2>
          <p className="text-[11px] text-zinc-500">点击加入骰池，右键移除一颗</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto grid h-7 w-7 place-items-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="关闭掷骰板"
          title="关闭掷骰板"
        >×</button>
      </header>

      <div className="p-3">
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {DICE_SIDES.map(sides => (
            <button
              type="button"
              key={sides}
              onClick={() => change(sides, 1)}
              onContextMenu={(event) => {
                event.preventDefault();
                change(sides, -1);
              }}
              className={`relative h-12 rounded-lg border text-sm font-semibold transition ${pool[sides]
                ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-700'}`}
              aria-label={`加入一颗 d${sides}，当前 ${pool[sides]} 颗`}
              title={`左键加入一颗 d${sides}；右键移除一颗`}
            >
              d{sides}
              {pool[sides] > 0 && (
                <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-amber-500 px-1 text-[10px] text-zinc-950">
                  {pool[sides]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <div className="min-w-0 flex-1 rounded-lg bg-zinc-950/70 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">骰池</div>
            <div className={`truncate font-mono text-sm ${formula ? 'text-zinc-100' : 'text-zinc-600'}`}>
              {formula || '点击上方骰子开始组合'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPool(emptyDicePool())}
            disabled={!count}
            className="h-11 rounded-lg px-3 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
          >清空</button>
          <button
            type="button"
            onClick={() => void roll()}
            disabled={!count}
            className="h-11 rounded-lg bg-amber-500 px-5 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
          >投掷</button>
        </div>

        {history.length > 0 && (
          <div className="mt-3 max-h-52 space-y-2 overflow-y-auto border-t border-zinc-700/70 pt-3" aria-live="polite">
            {history.map((entry, index) => (
              <article key={entry.id} className={`rounded-lg px-3 py-2 ${index === 0 ? 'bg-amber-500/10 ring-1 ring-amber-500/30' : 'bg-zinc-800/70'}`}>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-zinc-400">{entry.formula}</span>
                  <span className="ml-auto text-xs text-zinc-500">总计</span>
                  <strong className="text-xl tabular-nums text-amber-300">{entry.total}</strong>
                </div>
                <div className="mt-1 space-y-0.5 font-mono text-[11px] leading-5 text-zinc-400">
                  {entry.groups.map(group => (
                    <div key={group.sides} className="break-words">
                      d{group.sides}: {group.results.join(' + ')} = <span className="text-zinc-200">{group.subtotal}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
