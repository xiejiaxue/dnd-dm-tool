import type { Op, PlayerToken } from '../../../shared/types';
import {
  activeScene,
  isRoomModerator,
  type PersistedRoomState,
  type RoomActor,
} from '../domain';

/**
 * Turn server-authorized operations into the smallest safe projection for one
 * viewer. Returning null deliberately asks the room coordinator for a full
 * role-aware snapshot when an operation contains generated state.
 */
export function projectPatchOperations(state: PersistedRoomState, operations: Op[], actor: RoomActor): Op[] | null {
  const scene = activeScene(state);
  const canManage = isRoomModerator(actor.role);
  const projected: Op[] = [];
  for (const operation of operations) {
    switch (operation.op) {
      case 'moveToken':
      case 'removeToken':
      case 'updateToken':
      case 'removePlayer':
      case 'addWall':
      case 'removeWall':
      case 'updateGrid':
      case 'updateMap':
      case 'updateMapScale':
      case 'addFavorite':
      case 'removeFavorite':
      case 'setFog':
      case 'revealFogRect':
      case 'revealAllFog':
      case 'coverAllFog':
        projected.push(structuredClone(operation));
        break;
      case 'addToken': {
        // Monster numbering is assigned by applyOperation, so use the durable
        // record rather than the browser's pre-authorization payload.
        const token = scene.tokens.find((candidate) => candidate.id === operation.token.id);
        if (!token) return null;
        projected.push({ op: 'addToken', token: structuredClone(token) });
        break;
      }
      case 'addPlayer': {
        const player = scene.players.find((candidate) => candidate.id === operation.player.id);
        if (!player) return null;
        projected.push({ op: 'addPlayer', player: projectPlayerToken(player, actor, canManage) });
        break;
      }
      case 'updatePlayer': {
        const player = scene.players.find((candidate) => candidate.id === operation.tokenId);
        if (!player) return null;
        const patch = structuredClone(operation.patch);
        if ('sessionId' in patch) {
          patch.sessionId = canManage || player.sessionId === actor.userId ? player.sessionId : null;
        }
        projected.push({ op: 'updatePlayer', tokenId: operation.tokenId, patch });
        break;
      }
      case 'addEnemy':
      case 'removeEnemy':
      case 'upsertNpc':
      case 'removeNpc':
        if (canManage) projected.push(structuredClone(operation));
        break;
      case 'switchCampaign':
      case 'submitInitiative':
      case 'addToInitiative':
        return null;
      case 'removeFromInitiative':
      case 'advanceTurn':
      case 'reorderInitiative':
        projected.push(structuredClone(operation));
        break;
    }
  }
  return projected;
}

function projectPlayerToken(player: PlayerToken, actor: RoomActor, canManage: boolean): PlayerToken {
  return {
    ...structuredClone(player),
    sessionId: canManage || player.sessionId === actor.userId ? player.sessionId : null,
  };
}
