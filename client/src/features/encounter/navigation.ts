type Listener = (tokenId: string) => void;

const listeners = new Set<Listener>();

export function openEncounterReference(tokenId: string): void {
  for (const listener of listeners) listener(tokenId);
}

export function subscribeEncounterReference(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

