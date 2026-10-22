import { useMemo } from 'react';
import TokenShape from '../../components/TokenShape';
import type { Encounter, Scene } from '../../types';
import type { RoomViewRole } from '../../ws';
import { snapCoordinate } from './geometry';

interface Props {
  scene: Scene;
  encounter: Encounter | null;
  role: RoomViewRole;
  tool: string;
  selectedIds: readonly string[];
  mySessionId: string;
  onSelect: (id: string, additive: boolean) => void;
  onContextSelect: (id: string) => void;
  onMoveToken: (tokenId: string, x: number, y: number) => void;
}

/** Token rendering and drag permissions, independent from room transport. */
export default function BoardTokenLayer({ scene, encounter, role, tool, selectedIds, mySessionId, onSelect, onContextSelect, onMoveToken }: Props) {
  const activeTokenIds = useMemo(
    () => new Set(encounter?.status === 'active' && encounter.turn != null && encounter.combatants[encounter.turn]?.tokenId
      ? [encounter.combatants[encounter.turn].tokenId]
      : []),
    [encounter],
  );
  const grid = scene.grid;
  const interactionKey = `${grid.snap ? 1 : 0}:${grid.size}:${grid.offset[0]}:${grid.offset[1]}`;
  const toolsAllowDragging = tool !== 'wall' && tool !== 'erase' && tool !== 'multi';
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
          selected={selectedIds.includes(token.id)}
          draggable={role === 'dm' && toolsAllowDragging}
          interactionKey={interactionKey}
          onSelect={additive => onSelect(token.id, additive)}
          onDragEnd={(x, y) => move(token.id, x, y)}
          onContextMenu={() => onContextSelect(token.id)}
        />
      ))}
      {scene.players.map(player => (
        <TokenShape
          key={player.id}
          token={player}
          active={activeTokenIds.has(player.id)}
          selected={selectedIds.includes(player.id)}
          draggable={toolsAllowDragging && (role === 'dm' || (role === 'player' && player.sessionId === mySessionId))}
          interactionKey={interactionKey}
          onSelect={additive => onSelect(player.id, additive)}
          onDragEnd={(x, y) => move(player.id, x, y)}
          onContextMenu={() => onContextSelect(player.id)}
        />
      ))}
    </>
  );
}
