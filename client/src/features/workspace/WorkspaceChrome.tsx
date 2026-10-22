import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { FloatingRect, WorkspacePanelId } from './useWorkspaceLayout';

export function DockResizeHandle({ side, onResize }: { side: 'left' | 'right'; onResize(width: number): void }) {
  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const origin = event.clientX;
    const element = event.currentTarget.parentElement;
    const width = element?.getBoundingClientRect().width ?? 0;
    const move = (next: PointerEvent) => onResize(width + (next.clientX - origin) * (side === 'left' ? 1 : -1));
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };
  return <div role="separator" aria-orientation="vertical" aria-label="调整面板宽度" onPointerDown={start}
    className={`absolute bottom-0 top-0 z-30 w-1 cursor-col-resize hover:bg-amber-500/60 ${side === 'left' ? '-right-0.5' : '-left-0.5'}`} />;
}

export function FloatingWorkspacePanel({ panel, title, rect, onRect, onDock, onClose, active, onFocus, children }: {
  panel: WorkspacePanelId;
  title: string;
  rect: FloatingRect;
  onRect(rect: FloatingRect): void;
  onDock(): void;
  onClose(): void;
  active: boolean;
  onFocus(): void;
  children: ReactNode;
}) {
  const current = useRef(rect);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => { current.current = rect; }, [rect]);

  useLayoutEffect(() => {
    const parent = panelRef.current?.parentElement;
    if (!parent) return;
    const fit = () => {
      const bounds = parent.getBoundingClientRect();
      const w = Math.min(rect.w, Math.max(220, bounds.width - 8));
      const h = Math.min(rect.h, Math.max(260, bounds.height - 8));
      const next = {
        x: Math.max(0, Math.min(rect.x, bounds.width - w)),
        y: Math.max(0, Math.min(rect.y, bounds.height - h)),
        w,
        h,
      };
      if (next.x !== rect.x || next.y !== rect.y || next.w !== rect.w || next.h !== rect.h) onRect(next);
    };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(parent);
    return () => observer?.disconnect();
  }, [onRect, rect]);

  const drag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    const origin = { x: event.clientX, y: event.clientY, rect: current.current };
    const move = (next: PointerEvent) => onRect({ ...origin.rect, x: Math.max(0, origin.rect.x + next.clientX - origin.x), y: Math.max(0, origin.rect.y + next.clientY - origin.y) });
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };

  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const origin = { x: event.clientX, y: event.clientY, rect: current.current };
    const move = (next: PointerEvent) => onRect({ ...origin.rect, w: origin.rect.w + next.clientX - origin.x, h: origin.rect.h + next.clientY - origin.y });
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };

  return (
    <section ref={panelRef} data-workspace-panel={panel} onPointerDown={onFocus}
      className={`absolute flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-600 bg-zinc-900/95 shadow-2xl backdrop-blur ${active ? 'z-50' : 'z-40'}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      <header onPointerDown={drag} className="flex h-9 shrink-0 cursor-move items-center gap-2 border-b border-zinc-700 bg-zinc-800/90 px-2 text-xs text-zinc-300">
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <button type="button" onClick={onDock} className="rounded px-1.5 py-1 text-zinc-400 hover:bg-zinc-700 hover:text-white">停靠</button>
        <button type="button" onClick={onClose} aria-label={`关闭${title}`} title={`关闭${title}`} className="rounded px-1.5 py-1 text-zinc-400 hover:bg-zinc-700 hover:text-white">×</button>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
      <div onPointerDown={resize} aria-label={`调整${title}大小`} className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize border-b-2 border-r-2 border-amber-500/60" />
    </section>
  );
}
