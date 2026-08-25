import { useMemo } from 'react';
import TokenShape from '../../components/TokenShape';
import type { Scene } from '../../types';
import type { RoomViewRole } from '../../ws';
import { snapCoordinate } from './geometry';

interface Props {
  scene: Scene;
  role: RoomViewRole;
  tool: string;
  selectedId: string | null;
  mySessionId: string;
  onSelect: (id: string) => void;
  onMoveToken: (tokenId: string, x: number, y: number) => void;
}

/** Token rendering and drag permissions, independent from room transport. */
export default function BoardTokenLayer({ scene, role, tool, selectedId, mySessionId, onSelect, onMoveToken }: Props) {
  const activeTokenIds = useMemo(
    () => new Set(scene.initiative.filter(entry => entry.active && entry.tokenId).map(entry => entry.tokenId)),
    [scene.initiative],
  );
  const grid = scene.grid;
  const interactionKey = `${grid.snap ? 1 : 0}:${grid.size}:${grid.offset[0]}:${grid.offset[1]}`;
  const toolsAllowDragging = tool !== 'wall' && tool !== 'erase';
  const move = (tokenId: string, x: number, y: number) => {
    onMoveToken(tokenId, snapCoordinate(x, grid, 0), snapCoordinate(y, grid, 1));
  };

  return (
    <>
      {scene.tokens.map(token => (
        <TokenShape
          key={token.id}
          token={token}
          active={activeTokenIds.has(token.id)}
          selected={selectedId === token.id}
          draggable={role === 'dm' && toolsAllowDragging}
          interactionKey={interactionKey}
          onSelect={() => onSelect(token.id)}
          onDragEnd={(x, y) => move(token.id, x, y)}
          onContextMenu={() => onSelect(token.id)}
        />
      ))}
      {scene.players.map(player => (
        <TokenShape
          key={player.id}
          token={player}
          active={activeTokenIds.has(player.id)}
          selected={selectedId === player.id}
          draggable={toolsAllowDragging && (role === 'dm' || (role === 'player' && player.sessionId === mySessionId))}
          interactionKey={interactionKey}
          onSelect={() => onSelect(player.id)}
          onDragEnd={(x, y) => move(player.id, x, y)}
          onContextMenu={() => onSelect(player.id)}
        />
      ))}
    </>
  );
}
