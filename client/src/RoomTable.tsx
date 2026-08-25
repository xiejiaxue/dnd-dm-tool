import { useEffect, useState } from 'react';
import type { RoomBootstrap } from './api';
import BoardCanvas from './components/BoardCanvas';
import EnemyList from './components/EnemyList';
import InitiativePanel from './components/InitiativePanel';
import QueryPanel from './components/QueryPanel';
import Toolbar from './components/Toolbar';
import TopBar from './components/TopBar';
import { MapUploadProvider } from './features/map-upload/MapUploadProvider';
import { subscribe, type PendingToken } from './pending';
import { useScene } from './ws';

interface Props {
  room: RoomBootstrap;
  onLeaveRoom: () => void;
}

/**
 * Owns only the interactive tabletop composition. Routing and room-session
 * bootstrapping stay in App, while feature providers hide API/transport details
 * from the visual shell below.
 */
export default function RoomTable({ room, onLeaveRoom }: Props) {
  const { role } = useScene();
  const [tool, setTool] = useState('select');
  const [pending, setPending] = useState<PendingToken | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queryCollapsed, setQueryCollapsed] = useState(false);

  useEffect(() => subscribe(pickedUp => {
    setPending(pickedUp);
    if (pickedUp && role === 'dm') setTool('add');
  }), [role]);

  return (
    <MapUploadProvider>
      <div className="h-full flex flex-col">
        <TopBar roomName={room.room.name} roomSlug={room.room.slug} onLeaveRoom={onLeaveRoom} />
        <InitiativePanel selectedTokenId={selectedId} onClearSelected={() => setSelectedId(null)} />
        <div className="flex-1 flex min-h-0">
          <Toolbar
            role={role}
            tool={tool}
            onTool={setTool}
            pendingLabel={pending ? `点击棋盘放置：${pending.name}` : null}
          />
          <EnemyList selectedTokenId={selectedId} />
          <div className="flex-1 min-w-0 relative bg-zinc-900">
            <BoardCanvas
              tool={tool}
              pending={pending}
              onClearPending={() => setPending(null)}
              selectedId={selectedId}
              onSelect={setSelectedId}
              queryOpen={!queryCollapsed}
            />
          </div>
          <QueryPanel collapsed={queryCollapsed} onToggleCollapsed={() => setQueryCollapsed(value => !value)} />
        </div>
      </div>
    </MapUploadProvider>
  );
}
