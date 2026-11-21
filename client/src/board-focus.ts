/**
 * Asks the board to bring a spot of a scene's map into view, from anywhere in the table (the story
 * route, search results). The request waits until that scene is the one on the board, so a caller
 * may switch scenes first and the camera flies once the new map is there.
 */
export interface BoardFocus {
  sceneId: string;
  /** Spot on the map picture as [x, y] fractions of its width and height. */
  point?: [number, number];
  /** A keyed room of the module map to open in the room card. */
  areaKey?: string;
}

const MAX_WAIT_MS = 20_000;
let pending: (BoardFocus & { at: number }) | null = null;
const listeners = new Set<() => void>();

export function requestBoardFocus(focus: BoardFocus) {
  pending = { ...focus, at: Date.now() };
  for (const listener of listeners) listener();
}

/** The waiting request for this scene, removed once taken; stale requests are dropped. */
export function takeBoardFocus(sceneId: string | undefined): BoardFocus | null {
  if (!pending || Date.now() - pending.at > MAX_WAIT_MS) { pending = null; return null; }
  if (pending.sceneId !== sceneId) return null;
  const { at: _at, ...focus } = pending;
  pending = null;
  return focus;
}

export function onBoardFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
