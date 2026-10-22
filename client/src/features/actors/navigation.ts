type Listener = (actorId: string) => void;
const listeners = new Set<Listener>();
let pending: string | null = null;
export function openActorSheet(actorId: string): void { pending = actorId; for (const listener of listeners) listener(actorId); }
export function subscribeActorNavigation(listener: Listener): () => void { listeners.add(listener); if (pending) listener(pending); return () => listeners.delete(listener); }

