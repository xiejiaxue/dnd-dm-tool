import type { NpcRecord } from '../../types';
import StatBlockView from '../../components/StatBlockView';
import { normalizeNpcMetadata } from '../../../../shared/npc-metadata';
import { useResolvedNpcData } from './useResolvedNpcData';

const STATUS_LABEL: Record<NpcRecord['status'], string> = {
  active: '活跃', missing: '失踪', inactive: '退场', dead: '死亡',
};

/** Compact NPC rules drawer used by the left encounter list. */
export default function NpcEncounterDrawer({ npc, records, onBack, readOnly = false }: {
  npc: NpcRecord;
  records: readonly NpcRecord[];
  onBack: () => void;
  readOnly?: boolean;
}) {
  const normalized = normalizeNpcMetadata(npc);
  const showRules = !readOnly || normalized.playerAccess === 'observer';
  const { data, loading } = useResolvedNpcData(normalized, records, showRules);
  const publicDescription = normalized.publicDescription?.trim() || (readOnly ? normalized.notesMarkdown.trim() : '');
  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-zinc-900 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="返回敌人列表" title="返回敌人 / NPC 列表" className="text-zinc-400 hover:text-white">←</button>
        <h2 className="min-w-0 flex-1 truncate text-base font-bold text-zinc-100">{normalized.name}</h2>
        <span className="text-[10px] text-zinc-500">{STATUS_LABEL[normalized.status]}</span>
      </div>
      <div className="mb-2 truncate text-[11px] text-zinc-500">{normalized.groupPath?.join(' / ')}</div>
      {(normalized.role || normalized.location) && (
        <div className="mb-2 text-xs text-zinc-400">{[normalized.role, normalized.location].filter(Boolean).join(' · ')}</div>
      )}
      {publicDescription && (
        <div className="mb-3 whitespace-pre-wrap border-l-2 border-sky-800 pl-2 text-xs leading-relaxed text-zinc-300">
          {publicDescription}
        </div>
      )}
      {readOnly && !showRules && <div className="text-xs text-zinc-500">该 NPC 的规则数据未向玩家公开。</div>}
      {loading && <div className="text-xs text-zinc-500">正在载入数据…</div>}
      {data && (
        <>
          <div className="mb-2 border-l-2 border-zinc-700 pl-2 text-[10px] text-zinc-500">数据：{data.sourceLabel}</div>
          <StatBlockView stat={data.stat} />
        </>
      )}
    </div>
  );
}
