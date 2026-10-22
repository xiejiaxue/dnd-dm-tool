import { useEffect, useState } from 'react';
import { api, type CharacterSheet } from '../api';
import type { EntryType } from '../types';
import { ENTRY_KIND_ZH, formatCompendiumEntry } from '../format';
import { printSheet, type SheetEntryBlock } from '../characterSheetPrint';
import DetailDrawer from './DetailDrawer';

export default function CharacterSheetPanel({ onClose }: { onClose: () => void }) {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [detail, setDetail] = useState<{ type: EntryType; id: string; nameZh: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  useEffect(() => { void api.characterSheet().then(setSheet); }, []);

  // Full records live in the compendium; the sheet row only carries the id
  // trio. Resolve each entry's stat block, then hand the print engine a
  // complete document. Sequential keeps the request pattern gentle.
  const exportPdf = async () => {
    if (!sheet || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const blocks: SheetEntryBlock[] = [];
      for (const entry of sheet.entries) {
        const raw = await api.entry(entry.type, entry.entryId);
        blocks.push({ ...formatCompendiumEntry(entry.type, raw), type: entry.type, source: entry.source });
      }
      printSheet({
        name: sheet.character.name,
        color: sheet.character.color,
        maxHp: sheet.character.maxHp,
        blocks,
      });
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const typeLabel = (type: EntryType) => ENTRY_KIND_ZH[type] ?? type;

  return (
    <div className="absolute right-3 top-12 z-40 flex h-[70vh] w-[min(92vw,520px)] flex-col overflow-hidden border border-ink bg-panel shadow-[4px_4px_0_0_rgba(17,17,16,0.12)]">
      <div className="flex items-center border-b-2 border-ink px-4 py-3">
        <div>
          <p className="panel-label">D&amp;D 5E 角色卡</p>
          <h2 className="font-bold tracking-tight">{sheet?.character.name ?? '加载中…'}</h2>
        </div>
        {sheet && (
          <div className="ml-4 flex items-center gap-1.5 text-xs text-muted">
            <span aria-hidden className="h-2.5 w-2.5" style={{ backgroundColor: sheet.character.color }} />
            最大生命 <span className="font-medium tabular-nums text-ink">{sheet.character.maxHp}</span>
          </div>
        )}
        <button
          onClick={() => { void exportPdf(); }}
          disabled={!sheet || exporting}
          title="生成 A4 角色卡，在打印对话框中选择“另存为 PDF”"
          className="btn-accent ml-auto"
        >{exporting ? '生成中…' : '导出 PDF'}</button>
        <button onClick={onClose} className="ml-3 text-faint hover:text-accent transition-colors duration-150">✕</button>
      </div>
      {exportError && <p className="border-b border-line border-l-4 border-l-accent bg-well px-4 py-1.5 text-xs text-accent">{exportError}</p>}
      <div className="relative flex-1 overflow-y-auto">
        {sheet?.entries.map(entry => (
          <div key={entry.id} className="group flex items-center gap-2 border-b border-line px-3 py-2 hover:bg-well transition-colors duration-150">
            <button onClick={() => setDetail({ type: entry.type, id: entry.entryId, nameZh: entry.name })} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-ink">{entry.name}</span>
              <span className="text-xs text-muted">{typeLabel(entry.type)} · {entry.source}</span>
            </button>
            <button onClick={() => { void api.removeCharacterEntry(entry.id).then(() => api.characterSheet()).then(setSheet); }} className="text-faint group-hover:text-muted hover:text-accent transition-colors duration-150">✕</button>
          </div>
        ))}
        {sheet && sheet.entries.length === 0 && <p className="p-6 text-center text-sm text-muted">在资料详情中点击“加入角色卡”，即可添加法术、装备、专长、职业能力等。</p>}
        {detail && <DetailDrawer entry={detail} onBack={() => setDetail(null)} />}
      </div>
    </div>
  );
}
