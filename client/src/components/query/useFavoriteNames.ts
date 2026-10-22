import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../api';
import type { Scene } from '../../types';

export function useFavoriteNames(favorites: Scene['favorites'] | undefined) {
  const [favNames, setFavNames] = useState<Record<string, string>>({});
  const favNotFoundAt = useRef(new Map<string, number>());
  const favRequests = useRef(new Set<string>());

  useEffect(() => {
    const favs = favorites ?? [];
    const now = Date.now();
    const missing = favs.filter(f => {
      const notFoundAt = favNotFoundAt.current.get(f.entryId);
      return !(f.entryId in favNames) && !favRequests.current.has(f.entryId)
        && (notFoundAt === undefined || now - notFoundAt >= 60_000);
    });
    if (missing.length === 0) return;
    let alive = true;
    for (const f of missing) {
      if (favRequests.current.has(f.entryId)) continue;
      favRequests.current.add(f.entryId);
      api.entry(f.type, f.entryId)
        .then(e => { if (alive) setFavNames(prev => ({ ...prev, [f.entryId]: e.name ?? f.entryId })); })
        .catch(error => {
          // Cache 404s even if a new state message has already cleaned up this effect.
          if (error instanceof ApiError && error.status === 404) {
            favNotFoundAt.current.set(f.entryId, Date.now());
          }
        })
        .finally(() => { favRequests.current.delete(f.entryId); });
    }
    return () => { alive = false; };
  }, [favorites, favNames]);

  return favNames;
}
