import { useEffect, useState, type FormEvent } from 'react';
import { api, type CurrentUser, type RoomSummary } from './api';

interface Props {
  inviteError?: string | null;
  onOpenRoom: (slug: string) => void;
}

export default function Lobby({ inviteError, onOpenRoom }: Props) {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      // `api.me()` establishes the anonymous session cookie before room
      // listing. Do not make these first-visit requests in parallel.
      const user = await api.me();
      const list = await api.rooms();
      setMe(user);
      setRooms(list);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法连接服务');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const createRoom = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(null);
    try {
      const room = await api.createRoom(trimmed);
      onOpenRoom(room.slug);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建房间失败');
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="h-full flex items-center justify-center px-4 py-10 bg-zinc-950">
      <section className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950">
          <p className="text-amber-400 text-sm font-medium">DND DM 追踪</p>
          <h1 className="text-2xl font-semibold mt-1">选择一个游戏房间</h1>
          <p className="text-sm text-zinc-400 mt-2">
            房间通过网址连接；邀请链接会自动把你加入对应桌面。
          </p>
          {me && <p className="mt-3 text-xs text-zinc-500">当前身份：{me.displayName ?? me.id}</p>}
        </div>

        <div className="p-6 grid gap-6 md:grid-cols-[1fr_0.9fr]">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-medium">我的房间</h2>
              <button onClick={() => { void load(); }} className="text-xs text-zinc-400 hover:text-white">刷新</button>
            </div>
            {loading ? (
              <p className="text-sm text-zinc-500 py-4">正在读取房间…</p>
            ) : rooms.length === 0 ? (
              <p className="text-sm text-zinc-500 py-4">还没有加入任何房间。创建一个，或打开朋友发来的邀请链接。</p>
            ) : (
              <ul className="space-y-2">
                {rooms.map(room => (
                  <li key={room.id || room.slug}>
                    <button
                      onClick={() => onOpenRoom(room.slug)}
                      className="w-full text-left rounded-lg border border-zinc-800 bg-zinc-950/50 hover:border-amber-500/50 hover:bg-zinc-800 px-3 py-3 transition-colors"
                    >
                      <span className="block font-medium truncate">{room.name}</span>
                      <span className="block mt-1 text-xs text-zinc-500">
                        {room.role ? `权限：${room.role}` : '进入桌面'} · /r/{room.slug}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={createRoom} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4 self-start">
            <h2 className="font-medium">创建房间</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">你会成为该房间的拥有者，可以创建邀请链接并管理桌面。</p>
            <label className="block mt-4 text-xs text-zinc-400" htmlFor="room-name">房间名称</label>
            <input
              id="room-name"
              value={name}
              onChange={event => setName(event.target.value)}
              maxLength={80}
              autoComplete="off"
              placeholder="例如：周五龙与地下城"
              className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              disabled={!name.trim() || creating}
              className="mt-3 w-full rounded bg-amber-500/20 px-3 py-2 text-sm text-amber-300 hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >{creating ? '正在创建…' : '创建并进入'}</button>
          </form>
        </div>

        {(inviteError || error) && (
          <div className="mx-6 mb-6 rounded border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            {inviteError || error}
          </div>
        )}
      </section>
    </main>
  );
}
