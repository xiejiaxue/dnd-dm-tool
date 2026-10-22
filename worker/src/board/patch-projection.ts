import type { Op, PlayerToken } from '../../../shared/types';
import {
  activeScene,
  canReadAllRoomData,
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
  const canReadAll = canReadAllRoomData(actor);
  const projected: Op[] = [];
  for (const operation of operations) {
    switch (operation.op) {
      case 'moveToken': {
        if (canReadAll) {
          projected.push(structuredClone(operation));
          break;
        }
        const token = scene.tokens.find(candidate => candidate.id === operation.tokenId);
        if (token?.hidden === true) break;
        projected.push(structuredClone(operation));
        break;
      }
      case 'updateToken': {
        if ('conditions' in operation.patch) return null;
        if (canReadAll) {
          projected.push(structuredClone(operation));
          break;
        }
        const token = scene.tokens.find(candidate => candidate.id === operation.tokenId);
        if ('hidden' in operation.patch || 'publicName' in operation.patch || 'hpVisibility' in operation.patch) return null;
        if (!token || token.hidden === true) break;
        if ('hp' in operation.patch && (token.hpVisibility ?? 'value') !== 'value') return null;
        const patch = structuredClone(operation.patch);
        if (token.publicName?.trim()) delete patch.name;
        if (Object.keys(patch).length > 0) projected.push({ ...operation, patch });
        break;
      }
      case 'removePlayer':
      case 'addWall':
      case 'removeWall':
      case 'updateWall':
      case 'updateGrid':
      case 'updateMap':
      case 'updateMapScale':
      case 'addFavorite':
      case 'removeFavorite':
      case 'setFog':
      case 'revealFogRect':
      case 'revealAllFog':
      case 'coverAllFog':
      case 'restoreFog':
        projected.push(structuredClone(operation));
        break;
      case 'addToken': {
        // Monster numbering is assigned by applyOperation, so use the durable
        // record rather than the browser's pre-authorization payload.
        const token = scene.tokens.find((candidate) => candidate.id === operation.token.id);
        if (!token) return null;
        if (!canReadAll && token.hidden === true) break;
        // Visible additions may require alias, HP, and NPC-document redaction;
        // a role-aware snapshot is safer than duplicating that policy here.
        if (!canReadAll) return null;
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
        if ('conditions' in operation.patch) return null;
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
        if (canReadAll) projected.push(structuredClone(operation));
        else return null;
        break;
      case 'switchCampaign':
      case 'removeToken':
      case 'submitInitiative':
      case 'addToInitiative':
      case 'removeFromInitiative':
      case 'setCombatantHidden':
      case 'updateCombatant':
      case 'createEncounter':
      case 'duplicateEncounter':
      case 'startEncounter':
      case 'endEncounter':
      case 'previousTurn':
      case 'nextTurn':
      case 'previousRound':
      case 'nextRound':
      case 'endMyTurn':
      case 'advanceTurn':
      case 'reorderInitiative':
        return null;
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
