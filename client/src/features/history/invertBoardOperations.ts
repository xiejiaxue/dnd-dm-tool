import type { Encounter, Op, Scene, Token, Wall } from '../../types';

/** Build a bounded inverse before the optimistic command changes the visible
 * scene. Unsupported campaign/combat commands deliberately skip history. */
export function invertBoardOperations(scene: Scene, encounter: Encounter | null, operations: readonly Op[]): Op[] | null {
  let inverse: Op[] = [];
  for (const operation of operations) {
    const next = inverseOperation(scene, encounter, operation);
    if (!next) return null;
    inverse = [...next, ...inverse];
  }
  return inverse;
}

function inverseOperation(scene: Scene, encounter: Encounter | null, operation: Op): Op[] | null {
  switch (operation.op) {
    case 'moveToken': {
      const token = findToken(scene, operation.tokenId);
      return token ? [{ op: 'moveToken', tokenId: token.id, x: token.x, y: token.y }] : null;
    }
    case 'addToken': return [{ op: 'removeToken', tokenId: operation.token.id }];
    case 'removeToken': {
      const token = scene.tokens.find(candidate => candidate.id === operation.tokenId);
      if (!token) return null;
      const combatant = encounter?.combatants.find(candidate => candidate.tokenId === token.id);
      return [
        { op: 'addToken', token: cloneToken(token) },
        ...(combatant ? [{ op: 'addToInitiative' as const, name: combatant.name, value: combatant.value, source: 'dm' as const, tokenId: token.id }] : []),
      ];
    }
    case 'updateToken': {
      const token = scene.tokens.find(candidate => candidate.id === operation.tokenId);
      return token ? [{ op: 'updateToken', tokenId: token.id, patch: previousTokenPatch(token, operation.patch) }] : null;
    }
    case 'addPlayer': return [{ op: 'removePlayer', tokenId: operation.player.id }];
    case 'removePlayer': {
      const player = scene.players.find(candidate => candidate.id === operation.tokenId);
      if (!player) return null;
      const combatant = encounter?.combatants.find(candidate => candidate.tokenId === player.id);
      return [
        { op: 'addPlayer', player: { ...cloneToken(player), sessionId: player.sessionId } },
        ...(combatant ? [{ op: 'addToInitiative' as const, name: combatant.name, value: combatant.value, source: 'dm' as const, tokenId: player.id }] : []),
      ];
    }
    case 'updatePlayer': {
      const player = scene.players.find(candidate => candidate.id === operation.tokenId);
      if (!player) return null;
      const patch: Extract<Op, { op: 'updatePlayer' }>['patch'] = {};
      for (const key of Object.keys(operation.patch) as Array<keyof typeof operation.patch>) {
        if (key === 'hp') patch.hp = player.hp ? { ...player.hp } : null;
        else if (key === 'conditions') patch.conditions = player.conditions?.map(condition => ({ ...condition })) ?? [];
        else if (key === 'name') patch.name = player.name;
        else if (key === 'size') patch.size = player.size;
        else if (key === 'color') patch.color = player.color;
        else if (key === 'avatar') patch.avatar = player.avatar;
        else if (key === 'sessionId') patch.sessionId = player.sessionId;
      }
      return [{ op: 'updatePlayer', tokenId: player.id, patch }];
    }
    case 'addWall': return [{ op: 'removeWall', wallId: operation.wall.id }];
    case 'removeWall': {
      const wall = scene.walls.find(candidate => candidate.id === operation.wallId);
      return wall ? [{ op: 'addWall', wall: cloneWall(wall) }] : null;
    }
    case 'updateWall': {
      const wall = scene.walls.find(candidate => candidate.id === operation.wallId);
      if (!wall) return null;
      const patch: Extract<Op, { op: 'updateWall' }>['patch'] = {};
      if (operation.patch.p1) patch.p1 = [...wall.p1];
      if (operation.patch.p2) patch.p2 = [...wall.p2];
      return [{ op: 'updateWall', wallId: wall.id, patch }];
    }
    case 'updateGrid': {
      const patch: Extract<Op, { op: 'updateGrid' }>['patch'] = {};
      if (operation.patch.size !== undefined) patch.size = scene.grid.size;
      if (operation.patch.color !== undefined) patch.color = scene.grid.color;
      if (operation.patch.offset !== undefined) patch.offset = [...scene.grid.offset];
      if (operation.patch.snap !== undefined) patch.snap = scene.grid.snap;
      return [{ op: 'updateGrid', patch }];
    }
    case 'updateMapScale': return [{ op: 'updateMapScale', mapScale: scene.mapScale ?? 1 }];
    case 'updateMap': return [
      { op: 'updateMap', mapImage: scene.mapImage, mapSize: [...scene.mapSize], playArea: { ...scene.playArea } },
      { op: 'updateMapScale', mapScale: scene.mapScale ?? 1 },
      fogSnapshot(scene),
    ];
    case 'setFog':
    case 'revealFogRect':
    case 'revealAllFog':
    case 'coverAllFog':
    case 'restoreFog':
      return [fogSnapshot(scene)];
    default:
      return null;
  }
}

function fogSnapshot(scene: Scene): Extract<Op, { op: 'restoreFog' }> {
  return {
    op: 'restoreFog',
    fog: scene.fog && scene.fog.length <= 100_000 ? [...scene.fog] : null,
    fogReveals: (scene.fogReveals ?? []).map(rect => ({ ...rect })),
  };
}

function previousTokenPatch(token: Token, patch: Extract<Op, { op: 'updateToken' }>['patch']): Extract<Op, { op: 'updateToken' }>['patch'] {
  const previous: Extract<Op, { op: 'updateToken' }>['patch'] = {};
  if (patch.name !== undefined) previous.name = token.name;
  if (patch.size !== undefined) previous.size = token.size;
  if (patch.avatar !== undefined) previous.avatar = token.avatar;
  if (patch.color !== undefined) previous.color = token.color;
  if (patch.hp !== undefined) previous.hp = token.hp ? { ...token.hp } : null;
  if (patch.hidden !== undefined) previous.hidden = Boolean(token.hidden);
  if (patch.publicName !== undefined) previous.publicName = token.publicName ?? '';
  if (patch.hpVisibility !== undefined) previous.hpVisibility = token.hpVisibility ?? 'value';
  if (patch.conditions !== undefined) previous.conditions = token.conditions?.map(condition => ({ ...condition })) ?? [];
  return previous;
}

function findToken(scene: Scene, id: string) {
  return scene.tokens.find(token => token.id === id) ?? scene.players.find(player => player.id === id);
}

function cloneToken<T extends Token>(token: T): T {
  return {
    ...token,
    ...(token.hp ? { hp: { ...token.hp } } : {}),
    ...(token.conditions ? { conditions: token.conditions.map(condition => ({ ...condition })) } : {}),
  };
}

function cloneWall(wall: Wall): Wall {
  return { ...wall, p1: [...wall.p1], p2: [...wall.p2] };
}
