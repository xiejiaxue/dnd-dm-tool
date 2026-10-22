import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Op } from '../../types';

export interface BoardCommandApi {
  performOps(label: string, operations: Op[]): void;
}

const BoardCommandContext = createContext<BoardCommandApi | null>(null);

/** One room-scoped command boundary keeps feature panels independent from the
 * WebSocket transport and guarantees Placeable mutations share undo history. */
export function BoardCommandProvider({ performOps, children }: BoardCommandApi & { children: ReactNode }) {
  const value = useMemo(() => ({ performOps }), [performOps]);
  return <BoardCommandContext.Provider value={value}>{children}</BoardCommandContext.Provider>;
}

export function useBoardCommands(): BoardCommandApi {
  const value = useContext(BoardCommandContext);
  if (!value) throw new Error('Board commands require a room command provider');
  return value;
}
