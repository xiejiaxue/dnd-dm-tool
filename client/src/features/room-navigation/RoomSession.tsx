import { useEffect, useState } from 'react';
import { ApiError, api, setCurrentRoomSlug, type RoomBootstrap } from '../../api';
import RoomTable from '../../RoomTable';
import { connection } from '../../ws';

export function RoomLoading({ message }: { message: string }) {
  return (
    <main className="h-full flex items-center justify-center bg-zinc-950 text-zinc-400">
      <p className="text-sm">{message}</p>
    </main>
  );
}

/** Verifies room access, owns the socket lifecycle, then mounts the table. */
export function RoomSession({ slug, onLeaveRoom }: { slug: string; onLeaveRoom: () => void }) {
  const [bootstrap, setBootstrap] = useState<RoomBootstrap | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBootstrap(null);
    setError(null);
    setCurrentRoomSlug(slug);

    void (async () => {
      try {
        // Waiting for the identity request prevents first-visit bootstrap from
        // minting a second session beside an in-flight invite redemption.
        await api.me();
        const data = await api.bootstrap();
        if (cancelled) return;
        setBootstrap(data);
        connection.connect(slug);
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

  return <RoomTable key={slug} room={bootstrap} onLeaveRoom={onLeaveRoom} />;
}
