import Lobby from './Lobby';
import FilingFooter from './components/FilingFooter';
import { RoomLoading, RoomSession } from './features/room-navigation/RoomSession';
import { useRoomNavigation } from './features/room-navigation/useRoomNavigation';

/** Application composition only; navigation and room lifecycle live in features. */
export default function App() {
  const {
    roomSlug,
    inviteToken,
    inviteError,
    enterRoom,
    leaveRoom,
    joinRoom,
  } = useRoomNavigation();

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      <div className="min-h-0 flex-1">
        {inviteToken
          ? <RoomLoading message="正在加入邀请房间…" />
          : roomSlug
          ? <RoomSession key={roomSlug} slug={roomSlug} onLeaveRoom={leaveRoom} />
          : <Lobby inviteError={inviteError} onOpenRoom={enterRoom} onJoinRoom={joinRoom} />}
      </div>
      <FilingFooter />
    </div>
  );
}
