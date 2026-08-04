import TopBar from './components/TopBar';
import Toolbar from './components/Toolbar';
import InitiativePanel from './components/InitiativePanel';
import QueryPanel from './components/QueryPanel';
import BoardCanvas from './components/BoardCanvas';

export default function App() {
  return (
    <div className="h-full flex flex-col">
      <TopBar />
      <InitiativePanel />
      <div className="flex-1 flex min-h-0">
        <Toolbar />
        <div className="flex-1 min-w-0 relative bg-zinc-900">
          <BoardCanvas />
        </div>
        <QueryPanel />
      </div>
    </div>
  );
}
