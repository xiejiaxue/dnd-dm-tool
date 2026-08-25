import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { EntryType, IndexEntry } from '../../types';

export type CompendiumResultSource = 'local' | 'online' | 'unavailable' | null;

/**
 * Owns the local-first compendium lookup policy and debounce lifecycle. The
 * query panel only renders the resulting state and no longer coordinates two
 * data sources itself.
 */
export function useCompendiumSearch(query: string, type: EntryType | 'all') {
  const [results, setResults] = useState<IndexEntry[]>([]);
  const [source, setSource] = useState<CompendiumResultSource>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const search = async () => {
        const normalized = query.trim();
        if (!normalized) {
          if (!cancelled) {
            setResults([]);
            setSource(null);
          }
          return;
        }

        try {
          const local = await api.search(normalized, type);
          if (cancelled) return;
          if (local.length > 0) {
            setResults(local);
            setSource('local');
            return;
          }

          const online = await api.searchOnline(normalized, type);
          if (cancelled) return;
          setResults(online);
          setSource('online');
        } catch {
          if (!cancelled) {
            setResults([]);
            setSource('unavailable');
          }
        }
      };
      void search();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, type]);

  return { results, source };
}
