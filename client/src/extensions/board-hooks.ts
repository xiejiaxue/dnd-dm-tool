import type { Op } from '../types';
import type { ExtensionRegistry } from './registry';

export interface CommittedOperationContext {
  roomSlug: string;
  sceneId: string | null;
  revision: number | null;
}

/** Emits lifecycle hooks only for operations accepted and projected by the server. */
export async function emitCommittedOperationHooks(
  registry: ExtensionRegistry,
  operations: readonly Op[],
  context: CommittedOperationContext,
): Promise<void> {
  for (const operation of operations) {
    const payload = { operation, ...context };
    if (operation.op === 'addToken') await registry.emit('tokenCreated', { ...payload, token: operation.token });
    else if (operation.op === 'addPlayer') await registry.emit('tokenCreated', { ...payload, token: operation.player });
    else if (operation.op === 'moveToken') await registry.emit('tokenMoved', payload);
    else if (operation.op === 'removeToken' || operation.op === 'removePlayer') await registry.emit('tokenDeleted', payload);
    else if (operation.op === 'startEncounter') await registry.emit('encounterStarted', payload);
    else if (operation.op === 'endEncounter') await registry.emit('encounterEnded', payload);
    else if (isTurnOperation(operation)) await registry.emit('turnChanged', payload);
  }
}

function isTurnOperation(operation: Op): boolean {
  return operation.op === 'nextTurn'
    || operation.op === 'previousTurn'
    || operation.op === 'nextRound'
    || operation.op === 'previousRound'
    || operation.op === 'endMyTurn'
    || operation.op === 'advanceTurn';
}
