export interface CombatEntry {
  id: string;
  name: string;
  initiative: number;
  bonus: number;
  hp: number;
  maxHp: number;
  tempHp: number;
}
export interface QuickCombat {
  entries: CombatEntry[];
  activeId: string | null;
  round: number;
}
export const emptyCombat = (): QuickCombat => ({ entries: [], activeId: null, round: 1 });
export function integer(value: unknown, minimum = 0, maximum = 9999): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.trunc(number))) : minimum;
}
export function changeHp(entry: CombatEntry, amount: number, mode: 'damage' | 'heal' | 'temporary'): CombatEntry {
  amount = integer(amount);
  if (mode === 'temporary') return { ...entry, tempHp: Math.max(entry.tempHp, amount) };
  if (mode === 'heal') return { ...entry, hp: Math.min(entry.maxHp, entry.hp + amount) };
  const absorbed = Math.min(entry.tempHp, amount);
  return { ...entry, tempHp: entry.tempHp - absorbed, hp: Math.max(0, entry.hp - (amount - absorbed)) };
}
export function sortInitiative(entries: CombatEntry[]): CombatEntry[] {
  return [...entries].sort((a, b) => b.initiative - a.initiative || b.bonus - a.bonus);
}
export function nextTurn(state: QuickCombat): QuickCombat {
  const entries = sortInitiative(state.entries);
  if (!entries.length) return emptyCombat();
  const index = entries.findIndex(entry => entry.id === state.activeId);
  const next = (index + 1) % entries.length;
  return { ...state, activeId: entries[next].id, round: index >= 0 && next === 0 ? state.round + 1 : state.round };
}
export function removeCombatEntry(state: QuickCombat, id: string): QuickCombat {
  const advanced = state.activeId === id ? nextTurn(state) : state;
  const entries = state.entries.filter(entry => entry.id !== id);
  return entries.length ? { ...advanced, entries } : emptyCombat();
}
export function parseQuickCombat(raw: string | null): QuickCombat {
  if (!raw) return emptyCombat();
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data.entries)) return emptyCombat();
    const seen = new Set<string>();
    const entries = data.entries.slice(0, 100).filter((entry: CombatEntry) => {
      if (!entry || typeof entry.id !== 'string' || typeof entry.name !== 'string' || seen.has(entry.id)) return false;
      seen.add(entry.id); return true;
    }).map((entry: CombatEntry) => ({
      id: entry.id, name: entry.name.slice(0, 80), initiative: integer(entry.initiative, -100, 100), bonus: integer(entry.bonus, -100, 100),
      maxHp: integer(entry.maxHp, 1), hp: integer(entry.hp, 0, integer(entry.maxHp, 1)), tempHp: integer(entry.tempHp),
    }));
    return { entries, round: integer(data.round, 1), activeId: entries.some((entry: CombatEntry) => entry.id === data.activeId) ? data.activeId : null };
  } catch { return emptyCombat(); }
}
