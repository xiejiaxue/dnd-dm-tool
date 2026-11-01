import type { TableMusic } from '../types';

/**
 * Where the shared track should be now, in seconds. Every browser derives it
 * from the room's last change, so a late joiner starts at the same point.
 * Returns null once a non-looping track has finished.
 */
export function expectedPosition(music: Pick<TableMusic, 'playing' | 'position' | 'updatedAt' | 'loop'>, now: number, duration: number): number | null {
  const elapsed = music.playing ? Math.max(0, (now - music.updatedAt) / 1000) : 0;
  const position = music.position + elapsed;
  if (!Number.isFinite(duration) || duration <= 0) return position;
  if (position < duration) return position;
  return music.loop ? position % duration : null;
}

/** The listener's own volume and mute; the DM never controls how loud it is for someone else. */
export interface ListenerSettings { volume: number; muted: boolean }
const KEY = 'table-music-listener';

export function readListenerSettings(): ListenerSettings {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ListenerSettings> | null;
    return {
      volume: typeof data?.volume === 'number' && Number.isFinite(data.volume) ? Math.max(0, Math.min(1, data.volume)) : 0.5,
      muted: data?.muted === true,
    };
  } catch {
    return { volume: 0.5, muted: false };
  }
}

export function saveListenerSettings(settings: ListenerSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode: keep the setting for this tab only */ }
}
