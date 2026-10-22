import { useEffect, useMemo, useRef, useState } from 'react';

export interface PaletteCommand { id: string; label: string; keywords?: string; disabled?: boolean; run(): void; }

export default function CommandPalette({ open, commands, onClose }: { open: boolean; commands: PaletteCommand[]; onClose(): void }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQuery(''); window.setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  useEffect(() => { if (!open) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }; window.addEventListener('keydown', close, { capture: true }); return () => window.removeEventListener('keydown', close, { capture: true }); }, [open, onClose]);
  const visible = useMemo(() => { const normalized = query.trim().toLowerCase(); return commands.filter(command => !normalized || `${command.label} ${command.keywords ?? ''}`.toLowerCase().includes(normalized)); }, [commands, query]);
  if (!open) return null;
  const run = (command: PaletteCommand) => { if (command.disabled) return; command.run(); onClose(); };
  return <div className="fixed inset-0 z-[100] flex justify-center bg-black/65 px-4 pt-[12vh]" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-label="命令与文档速查" className="h-fit max-h-[70vh] w-full max-w-xl overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"><input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && visible[0]) run(visible[0]); }} placeholder="搜索命令、角色、日志或物品…" className="w-full border-b border-zinc-800 bg-zinc-950 px-4 py-3 text-sm outline-none focus:border-amber-600" /><div className="max-h-[55vh] overflow-y-auto p-1">{visible.map(command => <button key={command.id} disabled={command.disabled} onClick={() => run(command)} className="flex w-full items-center rounded px-3 py-2 text-left text-sm hover:bg-zinc-800 disabled:text-zinc-700"><span>{command.label}</span><code className="ml-auto text-[10px] text-zinc-600">{command.id}</code></button>)}{visible.length === 0 && <p className="p-3 text-xs text-zinc-500">没有匹配的命令或文档。</p>}</div></section></div>;
}
