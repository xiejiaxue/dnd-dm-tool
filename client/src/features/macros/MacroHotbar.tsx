import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { registerCoreExtension, rollFormula } from '../../extensions/core';
import { extensionRegistry } from '../../extensions/registry';
import type { MacroDocument, MacroHotbarBinding } from '../../types';
import { useScene } from '../../ws';
import { openMacroLibrary } from './navigation';
import { useBoardCommands } from '../history/BoardCommandContext';

registerCoreExtension();

interface Props {
  onSelectTool?: (tool: string) => void;
  onOpenLibrary?: () => void;
}

export default function MacroHotbar({ onSelectTool, onOpenLibrary }: Props) {
  const { roomRole, scene } = useScene();
  const { performOps } = useBoardCommands();
  const [bindings, setBindings] = useState<MacroHotbarBinding[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const bySlot = useMemo(() => new Map(bindings.map(binding => [binding.slot, binding.macro])), [bindings]);

  const load = useCallback(async () => {
    try { setBindings(await api.macroHotbar()); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取宏快捷栏'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener('dndboard:macros-changed', refresh);
    return () => window.removeEventListener('dndboard:macros-changed', refresh);
  }, [load]);

  const execute = useCallback(async (macro: MacroDocument) => {
    try {
      await extensionRegistry.execute(macro.command, {
        roomRole,
        sceneId: scene?.id ?? null,
        sendOps: operations => performOps(`宏：${macro.name}`, operations),
        roll: formula => rollFormula(formula),
        selectTool: onSelectTool,
        notify: message => { setNotice(message); window.setTimeout(() => setNotice(''), 4_000); },
      });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '宏执行失败');
    }
  }, [roomRole, scene?.id, onSelectTool, performOps]);

  const slotsRef = useRef(bySlot);
  const executeRef = useRef(execute);
  slotsRef.current = bySlot;
  executeRef.current = execute;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const element = document.activeElement as HTMLElement | null;
      if (element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable)) return;
      const slot = event.key === '0' ? 10 : /^[1-9]$/u.test(event.key) ? Number(event.key) : null;
      if (!slot) return;
      const macro = slotsRef.current.get(slot);
      if (!macro) return;
      event.preventDefault();
      void executeRef.current(macro);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const bind = async (slot: number, macroId: string) => {
    if (!macroId) return;
    try {
      await api.setMacroHotbar(slot, macroId);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法绑定宏'); }
  };

  const clear = async (slot: number) => {
    try {
      await api.clearMacroHotbar(slot);
      setBindings(current => current.filter(binding => binding.slot !== slot));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法清除宏'); }
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex flex-col items-center gap-1 px-24">
      {(notice || error) && (
        <div className={`max-w-xl rounded px-3 py-1.5 text-xs shadow-lg ${error ? 'bg-red-950/95 text-red-300' : 'bg-emerald-950/95 text-emerald-300'}`}>
          {error || notice}
        </div>
      )}
      <div className="pointer-events-auto flex max-w-full gap-1 rounded-xl border border-zinc-700/80 bg-zinc-950/90 p-1.5 shadow-2xl shadow-black/60 backdrop-blur">
        {Array.from({ length: 10 }, (_, index) => index + 1).map(slot => {
          const macro = bySlot.get(slot);
          return (
            <button key={slot} type="button" draggable={Boolean(macro)}
              onDragStart={event => {
                if (!macro) return;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('application/x-dnd-macro-id', macro.id);
              }}
              onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
              onDrop={event => {
                event.preventDefault();
                const macroId = event.dataTransfer.getData('application/x-dnd-macro-id') || event.dataTransfer.getData('text/plain');
                void bind(slot, macroId);
              }}
              onClick={() => {
                if (macro) {
                  void execute(macro);
                  return;
                }
                onOpenLibrary?.();
                openMacroLibrary();
                setNotice('请从右侧宏列表拖入此槽位');
                window.setTimeout(() => setNotice(''), 4_000);
              }}
              onContextMenu={event => { event.preventDefault(); if (macro) void clear(slot); }}
              title={macro ? `${slot === 10 ? 0 : slot}：${macro.name}；右键清除` : `拖入宏绑定到数字键 ${slot === 10 ? 0 : slot}`}
              className={`relative h-11 w-14 overflow-hidden rounded-lg border text-[10px] ${macro ? 'cursor-pointer border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20' : 'border-zinc-800 bg-zinc-900/70 text-zinc-600 hover:border-zinc-600'}`}>
              <span className="absolute left-1 top-0.5 text-[9px] text-zinc-500">{slot === 10 ? 0 : slot}</span>
              <span className="block truncate px-1 pt-2">{macro?.name ?? '空'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
