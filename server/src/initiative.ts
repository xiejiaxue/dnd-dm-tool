import { InitiativeEntry } from './types';

export function sortInitiative(entries: InitiativeEntry[]): InitiativeEntry[] {
  return [...entries].sort((a, b) => b.value - a.value);
}

export function activeEntry(entries: InitiativeEntry[]): InitiativeEntry | null {
  return entries.find(x => x.active) ?? null;
}

export function advanceInitiative(entries: InitiativeEntry[]): InitiativeEntry[] {
  const next = entries.map(x => ({ ...x, active: false }));
  if (next.length === 0) return next;
  const cur = activeEntry(entries);
  let idx = cur ? next.findIndex(x => x.id === cur.id) + 1 : 0;
  if (idx >= next.length || idx < 0) idx = 0;
  next[idx].active = true;
  return next;
}
