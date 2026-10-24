import type { InitiativeEntry } from './types';

// The Durable Object and the browser's optimistic reducer both apply these, so
// a predicted turn change always matches the authoritative one.

/** Make the entry after the active one active, wrapping to the top of the order. */
export function advanceInitiative(entries: readonly InitiativeEntry[]): InitiativeEntry[] {
  if (entries.length === 0) return entries as InitiativeEntry[];
  const next = entries.map((entry) => ({ ...entry, active: false }));
  const activeIndex = entries.findIndex((entry) => entry.active);
  next[activeIndex < 0 ? 0 : (activeIndex + 1) % next.length].active = true;
  return next;
}

/**
 * Drop matching entries. When the active entry is among them, the turn passes
 * to the next surviving entry instead of being lost, so removing a defeated
 * creature mid-round does not send the next "advance" back to the top.
 */
export function removeInitiativeEntries(
  entries: readonly InitiativeEntry[],
  remove: (entry: InitiativeEntry) => boolean,
): InitiativeEntry[] {
  const kept = entries.filter((entry) => !remove(entry));
  if (kept.length === entries.length) return entries as InitiativeEntry[];
  const activeIndex = entries.findIndex((entry) => entry.active);
  if (activeIndex < 0 || !remove(entries[activeIndex])) return kept;
  for (let step = 1; step < entries.length; step += 1) {
    const candidate = entries[(activeIndex + step) % entries.length];
    if (!remove(candidate)) return kept.map((entry) => entry.id === candidate.id ? { ...entry, active: true } : entry);
  }
  return kept;
}
