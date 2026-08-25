import type { ReactNode } from 'react';

interface Props {
  depth: number;
  label: ReactNode;
  title?: string;
  kind: 'folder' | 'file';
  expanded?: boolean;
  active?: boolean;
  muted?: boolean;
  onClick?: () => void;
  actions?: ReactNode;
}

/** Compact, reusable tree row modeled after an editor explorer: fixed rhythm,
 * indentation guides, SVG glyphs, and actions that appear on hover/focus. */
export default function ExplorerRow({ depth, label, title, kind, expanded, active, muted, onClick, actions }: Props) {
  return (
    <div
      className={`group relative flex h-7 items-center text-xs ${active ? 'bg-amber-500/10 text-amber-300' : 'text-zinc-300 hover:bg-zinc-800/70'} ${muted ? 'opacity-60' : ''}`}
      style={{ paddingLeft: `${6 + depth * 14}px` }}
      title={title}
    >
      {depth > 0 && Array.from({ length: depth }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 top-0 w-px bg-zinc-800/80"
          style={{ left: `${12 + index * 14}px` }}
        />
      ))}
      <button
        type="button"
        onClick={onClick}
        className="relative z-[1] flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-amber-500/70"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-zinc-500" aria-hidden="true">
          {kind === 'folder' ? <FolderGlyph expanded={Boolean(expanded)} /> : <FileGlyph />}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      {actions && <div className="relative z-[2] mr-1 flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{actions}</div>}
    </div>
  );
}

export function ExplorerAction({ label, title, onClick, danger = false }: {
  label: ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={event => { event.stopPropagation(); onClick(); }}
      className={`h-6 min-w-6 rounded px-1 text-[10px] ${danger ? 'text-zinc-500 hover:bg-red-950/60 hover:text-red-300' : 'text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200'}`}
    >{label}</button>
  );
}

function FolderGlyph({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.25">
      <path d={expanded ? 'M1.8 5.2h12.4l-1.3 7H3.1l-1.3-7Z' : 'M2 3.5h4l1.2 1.4H14v7.3H2V3.5Z'} />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.25">
      <path d="M3.2 1.8h6.1l3.4 3.4v9H3.2v-12.4Z" />
      <path d="M9.2 1.9v3.5h3.4" />
    </svg>
  );
}
