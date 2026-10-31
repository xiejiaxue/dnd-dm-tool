import { useCallback, useState } from 'react';

const KEY = 'dm-fog-strength';
export const DEFAULT_DM_FOG_STRENGTH = 0.35;
export const MAX_DM_FOG_STRENGTH = 0.8;

/** A stored darkening level, clamped; anything unreadable falls back to the default. */
export function parseFogStrength(raw: string | null): number {
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? Math.min(MAX_DM_FOG_STRENGTH, Math.max(0, value)) : DEFAULT_DM_FOG_STRENGTH;
}

/** How dark covered fog looks to the DM. A per-browser preference: it never reaches players. */
export function useDmFogStrength(): [number, (value: number) => void] {
  const [strength, setStrength] = useState(() => {
    try { return parseFogStrength(localStorage.getItem(KEY)); } catch { return DEFAULT_DM_FOG_STRENGTH; }
  });
  const update = useCallback((value: number) => {
    const next = parseFogStrength(String(value));
    setStrength(next);
    try { localStorage.setItem(KEY, String(next)); } catch { /* private mode: keep it for this visit */ }
  }, []);
  return [strength, update];
}
