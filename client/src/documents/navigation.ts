export interface JournalTarget {
  journalId: string;
  pageId?: string | null;
}

type Listener = (target: JournalTarget) => void;
const listeners = new Set<Listener>();
let currentTarget: JournalTarget | null = null;

/** Public navigation boundary used by MapNotes, macros and directory views. */
export function openJournal(target: JournalTarget): void {
  currentTarget = target;
  for (const listener of listeners) listener(target);
}

export function subscribeJournalNavigation(listener: Listener): () => void {
  listeners.add(listener);
  if (currentTarget) listener(currentTarget);
  return () => listeners.delete(listener);
}
