// All mutations go through connection.sendOps; the server broadcasts the
// resulting state which useScene applies. This file only provides thin
// helpers so components don't construct raw Op objects.
import type { Op, Token, Wall } from './types';

export function moveToken(tokenId: string, x: number, y: number): Op {
  return { op: 'moveToken', tokenId, x, y };
}

export function addToken(token: Token): Op {
  return { op: 'addToken', token };
}

export function addWall(wall: Wall): Op {
  return { op: 'addWall', wall };
}
