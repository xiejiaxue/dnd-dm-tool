import { useEffect, useState } from 'react';
import Lobby from './Lobby';
import FilingFooter from './components/FilingFooter';
import { extensionRegistry } from './extensions/registry';
import { RoomLoading, RoomSession } from './features/room-navigation/RoomSession';
import { useRoomNavigation } from './features/room-navigation/useRoomNavigation';

/** Application composition only; navigation and room lifecycle live in features. */
export default function App() {
  const [standalonePath, setStandalonePath] = useState(() => location.pathname);
  const {
    roomSlug,
    inviteToken,
    inviteError,
    enterRoom,
    leaveRoom,
    joinRoom,
  } = useRoomNavigation();
  const standalonePages = extensionRegistry.listStandalonePages();
  const standalonePage = !inviteToken && !roomSlug
    ? extensionRegistry.standalonePageForPath(standalonePath)
    : undefined;

  useEffect(() => {
    const onPopState = () => setStandalonePath(location.pathname);
    addEventListener('popstate', onPopState);
    return () => removeEventListener('popstate', onPopState);
  }, []);

  const openStandalonePage = (path: string) => {
    history.pushState(null, '', path);
    setStandalonePath(path);
  };

  const closeStandalonePage = () => {
    history.pushState(null, '', '/');
    setStandalonePath('/');
  };

  const StandalonePage = standalonePage?.component;

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      <div className="min-h-0 flex-1">
        {StandalonePage
          ? <StandalonePage onExit={closeStandalonePage} />
          : inviteToken
          ? <RoomLoading message="正在加入邀请房间…" />
          : roomSlug
          ? <RoomSession key={roomSlug} slug={roomSlug} onLeaveRoom={leaveRoom} />
          : <Lobby
              inviteError={inviteError}
              standalonePages={standalonePages}
              onOpenStandalonePage={openStandalonePage}
              onOpenRoom={enterRoom}
              onJoinRoom={joinRoom}
            />}
      </div>
      <FilingFooter />
    </div>
  );
}
