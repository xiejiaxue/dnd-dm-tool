import { useEffect, useState } from 'react';
import { api, type CharacterSheet } from '../api';
import type { EntryType } from '../types';
import DetailDrawer from './DetailDrawer';
import { formatCompendiumEntry } from '../format';

export default function CharacterSheetPanel({ onClose }: { onClose: () => void }) {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [detail, setDetail] = useState<{ type: EntryType; id: string; nameZh: string } | null>(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  useEffect(() => { void api.characterSheet().then(setSheet).catch(error => setError(error.message)); }, []);
  const exportPdf = async () => {
    if (!sheet) return;
    setExporting(true); setError('');
    try {
      const sections = [];
      for (const entry of sheet.entries) {
        const detail = formatCompendiumEntry(entry.type, await api.entry(entry.type, entry.entryId));
        sections.push({title: entry.name, rows: [['类型 / 来源', `${entry.type} / ${entry.source}`], ['数量 / 准备', `${entry.quantity} / ${entry.prepared ? '已准备' : '未准备'}`], ...detail.rows] as [string,string][], paragraphs: [detail.meta,...detail.body.map(text => text.replace(/\*\*/g,''))]});
      }
      const {downloadCharacterPdf} = await import('../character-pdf');
      await downloadCharacterPdf({name:sheet.character.name, subtitle:'D&D 5e · 战役角色卡', sections:[{title:'角色信息',rows:[['角色名称',sheet.character.name],['最大生命值',String(sheet.character.maxHp)]]}, ...sections]});
    } catch(error) { setError(error instanceof Error ? `导出失败：${error.message}` : 'PDF 导出失败'); }
    finally { setExporting(false); }
  };

  return (
    <div className="absolute right-3 top-12 z-40 flex h-[70vh] w-[min(92vw,520px)] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
      <div className="flex items-center border-b border-zinc-800 px-4 py-3">
        <div><p className="text-xs text-zinc-500">D&D 5e 角色卡</p><h2 className="font-semibold">{sheet?.character.name ?? '加载中…'}</h2></div>
        {sheet && <div className="ml-4 text-xs text-zinc-400"><span style={{ color: sheet.character.color }}>●</span> 最大生命 {sheet.character.maxHp}</div>}
        <button disabled={!sheet || exporting} onClick={() => void exportPdf()} className="ml-auto px-3 py-2 text-sm">{exporting ? '导出中…' : '导出 PDF'}</button>
        <button aria-label="关闭角色卡" onClick={onClose} className="ml-auto text-zinc-400 hover:text-zinc-100">✕</button>
      </div>
      <div className="relative flex-1 overflow-y-auto">
        {error && <p role="alert" className="tool-error">{error}</p>}
        {sheet?.entries.map(entry => (
          <div key={entry.id} className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
            <button onClick={() => setDetail({ type: entry.type, id: entry.entryId, nameZh: entry.name })} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-zinc-200">{entry.name}</span><span className="text-xs text-zinc-500">{entry.type} · {entry.source}</span>
            </button>
            <button onClick={() => { void api.removeCharacterEntry(entry.id).then(() => api.characterSheet()).then(setSheet); }} className="text-zinc-600 hover:text-red-400">✕</button>
          </div>
        ))}
        {sheet && sheet.entries.length === 0 && <p className="p-6 text-center text-sm text-zinc-500">暂无条目</p>}
        {detail && <DetailDrawer entry={detail} onBack={() => setDetail(null)} />}
      </div>
    </div>
  );
}
