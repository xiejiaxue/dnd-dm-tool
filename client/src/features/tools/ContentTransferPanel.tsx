import { useState, type ChangeEvent } from 'react';
import { api } from '../../api';
import type { ActorDocument, ItemDocument, JournalEntryDocument, PlaylistDocument, RollTableDocument, EncounterPresetDocument, JsonValue, ToolDocument, ToolDocumentType } from '../../types';
import { useScene } from '../../ws';

interface ContentPackage {
  schema: 1;
  exportedAt: number;
  actors: ActorDocument[];
  journals: JournalEntryDocument[];
  tools: ToolDocument[];
}

export default function ContentTransferPanel() {
  const { role } = useScene();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const exportContent = async () => {
    setBusy(true);
    try {
      const [actors, journals, items, tables, playlists, presets] = await Promise.all([api.actors(), api.journals(), api.items(), api.rollTables(), api.playlists(), api.encounterPresets()]);
      const data: ContentPackage = { schema: 1, exportedAt: Date.now(), actors: actors.actors, journals, tools: [...items, ...tables, ...playlists, ...presets] };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `dnd-content-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
      setNotice(`已导出 ${data.actors.length} 个 Actor、${data.journals.length} 本日志和 ${data.tools.length} 项工具资料`); setError('');
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  const importContent = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.currentTarget.value = ''; if (!file) return;
    setBusy(true);
    try {
      const value = JSON.parse(await file.text()) as Partial<ContentPackage>;
      if (value.schema !== 1 || !Array.isArray(value.actors) || !Array.isArray(value.journals) || !Array.isArray(value.tools)) throw new Error('不支持的资料包格式');
      let count = 0;
      for (const actor of value.actors.slice(0, 500)) { await api.createActor({ name: actor.name, actorType: actor.actorType, avatar: actor.avatar, system: actor.system, ownership: actor.ownership }); count += 1; }
      for (const journal of value.journals.slice(0, 500)) { const created = await api.createJournal(journal.name, journal.ownership); for (const page of journal.pages.slice(0, 200)) await api.createJournalPage(created.id, { name: page.name, type: page.type, text: page.text, ...(page.assetUrl ? { assetUrl: page.assetUrl } : {}) }); count += 1; }
      for (const tool of value.tools.slice(0, 1000)) await api.createToolDocument(tool.documentType, { name: tool.name, folder: tool.folder, ownership: tool.ownership, data: toolData(tool) });
      setNotice(`已导入 ${count} 个 Actor/日志和 ${value.tools.length} 项工具资料；所有内容均为当前战役的新副本`); setError('');
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  return <div className="h-full overflow-y-auto p-3 text-xs"><h3 className="font-semibold text-zinc-100">战役资料包</h3><p className="mt-2 leading-5 text-zinc-500">导出 Actor、角色卡、日志页面、物品、随机表、播放列表和 Encounter 预设。导入时始终创建新 ID，不覆盖当前战役内容。</p><div className="mt-4 grid gap-2"><button onClick={() => void exportContent()} disabled={busy} className="rounded bg-sky-500/15 py-2 text-sky-300 disabled:opacity-40">导出 JSON 资料包</button>{role === 'dm' && <label className="cursor-pointer rounded bg-amber-500/15 py-2 text-center text-amber-300">导入为当前战役副本<input type="file" accept="application/json" disabled={busy} className="hidden" onChange={event => void importContent(event)} /></label>}</div>{busy && <p className="mt-3 text-zinc-500">正在处理，请勿关闭页面…</p>}{notice && <p className="mt-3 leading-5 text-emerald-400">{notice}</p>}{error && <p className="mt-3 leading-5 text-red-400">{error}</p>}<div className="mt-5 rounded border border-zinc-800 p-3 leading-5 text-zinc-600">素材文件仍保存在私有 R2 中，资料包保存其受保护 URL；跨服务器迁移时需另行迁移素材。当前房间地图、Token、迷雾和 Encounter 实时状态继续使用顶部房间备份功能。</div></div>;
}

function toolData(tool: ToolDocument): Record<string, JsonValue> {
  if (tool.documentType === 'item') { const value = tool as ItemDocument; return { itemType: value.itemType, image: value.image, description: value.description, system: value.system, actions: value.actions as unknown as JsonValue, effects: value.effects as unknown as JsonValue }; }
  if (tool.documentType === 'roll_table') { const value = tool as RollTableDocument; return { replacement: value.replacement, results: value.results as unknown as JsonValue }; }
  if (tool.documentType === 'playlist') return { tracks: (tool as PlaylistDocument).tracks as unknown as JsonValue };
  const value = tool as EncounterPresetDocument; return { combatants: value.combatants as unknown as JsonValue, notes: value.notes };
}
function message(cause: unknown): string { return cause instanceof Error ? cause.message : '资料包操作失败'; }

