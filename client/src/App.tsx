import { useCallback, useEffect, useRef, useState } from 'react';
import Lobby from './Lobby';
import { ApiError, api, setCurrentRoomSlug, type InviteResult, type RoomBootstrap } from './api';
import FilingFooter from './components/FilingFooter';
import TopBar from './components/TopBar';
import Toolbar from './components/Toolbar';
import InitiativePanel from './components/InitiativePanel';
import QueryPanel from './components/QueryPanel';
import EnemyList from './components/EnemyList';
import BoardCanvas from './components/BoardCanvas';
import CampaignPortal from './components/CampaignPortal';
import { useScene, connection } from './ws';
import { subscribe } from './pending';
import type { PendingToken } from './pending';
import { initialNavigation } from './routing';

function roomSlugFromInvite(result: InviteResult): string | null {
  return result.roomSlug ?? result.room?.slug ?? null;
}

function RoomLoading({ message }: { message: string }) {
  return (
    <main className="h-full flex items-center justify-center bg-zinc-950 text-zinc-400">
      <p className="text-sm">{message}</p>
    </main>
  );
}

function RoomSession({ slug, onLeaveRoom }: { slug: string; onLeaveRoom: () => void }) {
  const [bootstrap, setBootstrap] = useState<RoomBootstrap | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBootstrap(null);
    setError(null);
    setReady(false);
    setCurrentRoomSlug(slug);

    void (async () => {
      try {
        // A room always belongs to a cookie-bound identity. Waiting for this
        // request also prevents a first-visit bootstrap from minting a second
        // session beside an in-flight invite redemption.
        await api.me();
        const data = await api.bootstrap();
        if (cancelled) return;
        setBootstrap(data);
        const role = data.membership?.roomRole ?? data.membership?.role;
        const canEnter = !data.membership?.canManage
          && Boolean(data.activeCampaign)
          && (role !== 'player' || Boolean(data.selectedCharacter));
        if (canEnter) {
          setReady(true);
          connection.connect(slug);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error('无法进入这个房间'));
      }
    })();

    return () => {
      cancelled = true;
      if (connection.roomSlug === slug) connection.disconnect();
    };
  }, [slug]);

  if (error) {
    const needsInvite = error instanceof ApiError && error.code === 'ROOM_NOT_FOUND';
    return (
      <main className="h-full flex items-center justify-center bg-zinc-950 px-4">
        <div className="max-w-md rounded-lg border border-red-500/30 bg-zinc-900 p-6 text-center">
          <h1 className="font-semibold text-red-300">{needsInvite ? '你还没有加入这个房间' : '无法进入房间'}</h1>
          <p className="mt-2 text-sm text-zinc-400">
            {needsInvite
              ? '房间地址本身不会授予访问权限。请从大厅进入已加入的房间，或让主持人发送有效的邀请链接。'
              : error.message}
          </p>
          <button onClick={onLeaveRoom} className="mt-5 rounded bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700">返回大厅</button>
        </div>
      </main>
    );
  }
  if (!bootstrap) return <RoomLoading message="正在验证房间权限…" />;

  const enterSelectedCampaign = async () => {
    const data = await api.bootstrap();
    setBootstrap(data);
    setReady(true);
    connection.connect(slug);
  };

  if (!ready) {
    return <CampaignPortal room={bootstrap} onReady={enterSelectedCampaign} onLeave={onLeaveRoom} />;
  }

  return <Table key={slug} room={bootstrap} onLeaveRoom={onLeaveRoom} />;
}

function Table({ room, onLeaveRoom }: { room: RoomBootstrap; onLeaveRoom: () => void }) {
  const { role, roomRole, campaign } = useScene();
  const observedCampaignId = useRef<string | null>(null);
  const [tool, setTool] = useState('select');
  const [pending, setPendingState] = useState<PendingToken | null>(null);
  // Lifted from BoardCanvas so the InitiativePanel can add the board-selected
  // token to the initiative order with its tokenId (enables the turn highlight).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queryCollapsed, setQueryCollapsed] = useState(false);
  const [brushSize, setBrushSize] = useState(1);

  useEffect(() => subscribe((pickedUp) => {
    setPendingState(pickedUp);
    if (pickedUp && role === 'dm') setTool('add');
  }), [role]);

  useEffect(() => {
    if (!campaign?.id) return;
    if (observedCampaignId.current === null) {
      observedCampaignId.current = campaign.id;
      return;
    }
    if (observedCampaignId.current !== campaign.id && roomRole === 'player') {
      // The DM moved the whole room to another save. Reload the D1 bootstrap
      // so this player must select that campaign's isolated character before
      // reconnecting to its board.
      location.reload();
    }
    observedCampaignId.current = campaign.id;
  }, [campaign?.id, roomRole]);

  return (
    <div className="h-full flex flex-col">
      <TopBar roomName={room.room.name} roomSlug={room.room.slug} onLeaveRoom={onLeaveRoom} />
      <InitiativePanel selectedTokenId={selectedId} onClearSelected={() => setSelectedId(null)} />
      <div className="flex-1 flex min-h-0">
        <Toolbar
          role={role}
          tool={tool}
          onTool={setTool}
          pendingLabel={pending ? `点击棋盘放置：${pending.name}` : null}
          brushSize={brushSize}
          onBrushSize={setBrushSize}
        />
        <EnemyList />
        <div className="flex-1 min-w-0 relative bg-zinc-900">
          <BoardCanvas
            tool={tool}
            pending={pending}
            onClearPending={() => setPendingState(null)}
            selectedId={selectedId}
            onSelect={setSelectedId}
            queryOpen={!queryCollapsed}
            brushSize={brushSize}
          />
        </div>
        <QueryPanel collapsed={queryCollapsed} onToggleCollapsed={() => setQueryCollapsed(collapsed => !collapsed)} />
      </div>
    </div>
  );
}

export default function App() {
  const [initialRoute] = useState(() => initialNavigation(location.pathname, location.hash));
  const [roomSlug, setRoomSlug] = useState<string | null>(initialRoute.roomSlug);
  const [inviteToken, setInviteToken] = useState<string | null>(initialRoute.inviteToken);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const redeemedInvite = useRef<string | null>(null);

  const enterRoom = useCallback((slug: string, replace = false) => {
    const room = slug.trim();
    if (!room) return;
    const target = `/r/${encodeURIComponent(room)}`;
    if (replace) history.replaceState(null, '', target);
    else history.pushState(null, '', target);
    setCurrentRoomSlug(room);
    setInviteToken(null);
    setRoomSlug(room);
    setInviteError(null);
  }, []);

  const leaveRoom = useCallback(() => {
    connection.disconnect();
    setCurrentRoomSlug(null);
    setInviteToken(null);
    history.pushState(null, '', '/');
    setRoomSlug(null);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const next = initialNavigation(location.pathname, location.hash);
      if (next.inviteToken) {
        connection.disconnect();
        setCurrentRoomSlug(null);
        setInviteToken(next.inviteToken);
        setRoomSlug(null);
      } else {
        setCurrentRoomSlug(next.roomSlug);
        setInviteToken(null);
        setRoomSlug(next.roomSlug);
      }
      setInviteError(null);
    };
    addEventListener('popstate', onPopState);
    return () => removeEventListener('popstate', onPopState);
  }, []);

  // Invite credentials live in the URL fragment so browsers do not send them
  // in Referer headers. Do not mount RoomSession until redemption succeeds:
  // its D1 access check is intentionally denied for an as-yet-unjoined user.
  useEffect(() => {
    if (!inviteToken || redeemedInvite.current === inviteToken) return;
    redeemedInvite.current = inviteToken;
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    void api.me()
      .then(() => api.redeemInvite(inviteToken))
      .then(result => {
        const slug = roomSlugFromInvite(result);
        if (!slug) throw new Error('邀请响应没有包含房间地址');
        // The fragment is cleared synchronously above, so this is the only
        // redemption request even when React StrictMode replays effects.
        enterRoom(slug, true);
      })
      .catch(cause => {
        setInviteError(cause instanceof Error ? cause.message : '邀请链接无效或已失效');
        setInviteToken(current => current === inviteToken ? null : current);
      });
  }, [enterRoom, inviteToken]);

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      <div className="min-h-0 flex-1">
        {inviteToken
          ? <RoomLoading message="正在加入邀请房间…" />
          : roomSlug
          ? <RoomSession key={roomSlug} slug={roomSlug} onLeaveRoom={leaveRoom} />
          : <Lobby inviteError={inviteError} onOpenRoom={enterRoom} />}
      </div>
      <FilingFooter />
    </div>
  );
}
