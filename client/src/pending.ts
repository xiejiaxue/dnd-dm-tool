// Minimal global event bus so QueryPanel can hand a "picked-up" token to the
// board for click-to-place without threading props through many components.
// The board consumes it in `add` mode: click empty canvas -> addToken op.

export interface PendingToken {
  kind: 'monster' | 'player';
  name: string;
  entryId: string | null;
  avatar: string;
  color: string;
}

type Listener = (pending: PendingToken | null) => void;

let current: PendingToken | null = null;
const listeners = new Set<Listener>();

export function setPending(pending: PendingToken | null): void {
  current = pending;
  for (const l of listeners) l(current);
}

export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  cb(current);
  return () => listeners.delete(cb);
}
