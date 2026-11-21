import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

export interface PanelPosition { left: number; top: number }

/** Keeps the panel inside its box (its top-left corner when the box is smaller than the panel). */
export function clampPanel(position: PanelPosition, panel: { width: number; height: number }, box: { width: number; height: number }): PanelPosition {
  return {
    left: Math.round(Math.min(Math.max(0, box.width - panel.width), Math.max(0, position.left))),
    top: Math.round(Math.min(Math.max(0, box.height - panel.height), Math.max(0, position.top))),
  };
}

function load(key: string): PanelPosition | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as PanelPosition | null;
    return value && Number.isFinite(value.left) && Number.isFinite(value.top) ? value : null;
  } catch { return null; }
}

function save(key: string, position: PanelPosition | null) {
  try {
    if (position) localStorage.setItem(key, JSON.stringify(position));
    else localStorage.removeItem(key);
  } catch { /* private mode: the position just isn't remembered */ }
}

/** Room cards and map-note cards open in the same spot, wherever the user last dragged one. */
export const CARD_PANEL_KEY = 'dnd:panel:card';

const INTERACTIVE = 'button, input, textarea, select, a, label, summary';

/**
 * A floating board panel the user can move by its header. The spot is remembered per panel in
 * this browser; double-clicking the header puts the panel back where the layout places it.
 */
export function useDraggablePanel<T extends HTMLElement>(storageKey: string) {
  const ref = useRef<T>(null);
  const [position, setPosition] = useState<PanelPosition | null>(() => load(storageKey));
  const drag = useRef<{ pointerId: number; dx: number; dy: number; last: PanelPosition | null } | null>(null);
  const [dragging, setDragging] = useState(false);

  const fit = useCallback((next: PanelPosition) => {
    const panel = ref.current, box = panel?.offsetParent as HTMLElement | null;
    if (!panel || !box) return next;
    return clampPanel(next, { width: panel.offsetWidth, height: panel.offsetHeight }, { width: box.clientWidth, height: box.clientHeight });
  }, []);

  // A remembered spot from a bigger window, or a board that shrank, must not strand the panel.
  useEffect(() => {
    if (!position) return;
    const refit = () => setPosition(current => {
      if (!current) return current;
      const next = fit(current);
      return next.left === current.left && next.top === current.top ? current : next;
    });
    refit();
    const box = ref.current?.offsetParent;
    const observer = typeof ResizeObserver === 'undefined' || !box ? null : new ResizeObserver(refit);
    if (observer && box) observer.observe(box);
    window.addEventListener('resize', refit);
    return () => { observer?.disconnect(); window.removeEventListener('resize', refit); };
  }, [position !== null, fit]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest(INTERACTIVE)) return;
    const panel = ref.current;
    if (!panel) return;
    event.preventDefault();
    drag.current = { pointerId: event.pointerId, dx: event.clientX - panel.offsetLeft, dy: event.clientY - panel.offsetTop, last: null };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const next = fit({ left: event.clientX - current.dx, top: event.clientY - current.dy });
    current.last = next;
    setPosition(next);
  };
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const moved = drag.current.last;
    drag.current = null;
    setDragging(false);
    // A plain click (or the clicks of a double-click) leaves the remembered spot alone.
    if (moved) save(storageKey, moved);
  };
  const reset = (event: { target: EventTarget }) => {
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    setPosition(null);
    save(storageKey, null);
  };

  const style: CSSProperties | undefined = position ? { left: position.left, top: position.top, right: 'auto', bottom: 'auto' } : undefined;
  const handleProps = {
    onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onDoubleClick: reset,
    className: `panel-drag-handle${dragging ? ' is-dragging' : ''}`,
    title: '拖动移动 · 双击复位',
  };
  return { ref, style, handleProps, moved: position !== null };
}
