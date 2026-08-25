import { useEffect, useState } from 'react';
import type { NpcRecord } from '../../types';
import { resolveNpcData, type ResolvedNpcData } from './model';

/** Resolve either module-specific NPC rules or the exact linked compendium
 * entry. Both the campaign archive and encounter list use this one loader. */
export function useResolvedNpcData(npc: NpcRecord, records: readonly NpcRecord[]): {
  data: ResolvedNpcData | null;
  loading: boolean;
} {
  const [data, setData] = useState<ResolvedNpcData | null>(null);
  const [loading, setLoading] = useState(true);
  const referenceKey = JSON.stringify(npc.statReference ?? null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    resolveNpcData(npc, records)
      .then(result => { if (!cancelled) setData(result); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [npc.id, npc.notesMarkdown, referenceKey, records]);

  return { data, loading };
}
