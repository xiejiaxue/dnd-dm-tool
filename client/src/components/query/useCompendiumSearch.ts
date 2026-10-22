import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { EntryType, IndexEntry } from '../../types';

export function useCompendiumSearch() {
  const [q, setQ] = useState('');
  const [type, setType] = useState<EntryType | 'all'>('all');
  const [results, setResults] = useState<IndexEntry[]>([]);
  const [resultSource, setResultSource] = useState<'local' | 'online' | 'unavailable' | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      const search = async () => {
        if (!q.trim()) {
          if (!cancelled) {
            setResults([]);
            setResultSource(null);
          }
          return;
        }
        try {
          const local = await api.search(q, type);
          if (cancelled) return;
          if (local.length > 0) {
            setResults(local);
            setResultSource('local');
            return;
          }
          // R2 stays the default source. Only a miss reaches the limited,
          // cached same-origin Worker proxy for the online 5e 不全书 data.
          const online = await api.searchOnline(q, type);
          if (cancelled) return;
          setResults(online);
          setResultSource('online');
        } catch {
          if (!cancelled) {
            setResults([]);
            setResultSource('unavailable');
          }
        }
      };
      void search();
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, type]);

  return { q, setQ, type, setType, results, resultSource };
}
