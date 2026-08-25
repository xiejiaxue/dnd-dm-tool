import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { Favorite } from '../../types';

/** Resolve display names lazily while keeping the favorite records canonical. */
export function useFavoriteNames(favorites: readonly Favorite[]) {
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const missing = favorites.filter((favorite) => !(favorite.entryId in names));
    if (missing.length === 0) return;
    let active = true;
    for (const favorite of missing) {
      api.entry(favorite.type, favorite.entryId)
        .then((entry) => {
          if (!active) return;
          setNames((current) => ({ ...current, [favorite.entryId]: entry.name ?? favorite.entryId }));
        })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [favorites, names]);

  return names;
}
