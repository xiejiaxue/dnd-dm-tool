import { useEffect, useState } from 'react';
import TopBar from './components/TopBar';
import Toolbar from './components/Toolbar';
import InitiativePanel from './components/InitiativePanel';
import QueryPanel from './components/QueryPanel';
import EnemyList from './components/EnemyList';
import BoardCanvas from './components/BoardCanvas';
import { useScene, connection } from './ws';
import { setPending, subscribe } from './pending';
import type { PendingToken } from './pending';

export default function App() {
  const { role, scene } = useScene();
  const [tool, setTool] = useState('select');
  const [pending, setPendingState] = useState<PendingToken | null>(null);
  // Lifted from BoardCanvas so the InitiativePanel can add the board-selected
  // token to the initiative order with its tokenId (enables the turn highlight).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Collapsible query panel — players can shrink it to reclaim board space.
  const [queryCollapsed, setQueryCollapsed] = useState(false);

  // QueryPanel hands a "picked-up" token via the global bus; keep it in sync
  // and switch to the add tool so a DM can click-to-place right away.
  useEffect(() => {
    return subscribe((p) => {
      setPendingState(p);
      if (p && role === 'dm') setTool('add');
    });
  }, [role]);

  return (
    <div className="h-full flex flex-col">
      <TopBar />
      <InitiativePanel selectedTokenId={selectedId} onClearSelected={() => setSelectedId(null)} />
      <div className="flex-1 flex min-h-0">
        <Toolbar
          role={role}
          tool={tool}
          onTool={setTool}
          pendingLabel={pending ? `点击棋盘放置：${pending.name}` : null}
          gridShow={scene?.grid.show ?? true}
          onToggleGrid={() => connection.sendOps([{ op: 'updateGrid', patch: { show: !(scene?.grid.show ?? true) } }])}
        />
        <EnemyList />
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
        <QueryPanel collapsed={queryCollapsed} onToggleCollapsed={() => setQueryCollapsed(c => !c)} />
      </div>
    </div>
  );
}
