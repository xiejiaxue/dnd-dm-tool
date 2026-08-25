import { useEffect, useState, type FormEvent } from 'react';
import { api, type CurrentUser, type RoomSummary, type RoomTemplateSummary } from './api';
import { looksLikeRoomEntry } from './routing';

interface Props {
  inviteError?: string | null;
  onOpenRoom: (slug: string) => void;
  onJoinRoom: (value: string) => void | Promise<void>;
}

const MANAGER_ROLES = new Set(['host', 'dm', 'assistant_dm']);

const ROLE_LABELS: Record<string, string> = {
  host: '房主',
  dm: '地下城主',
  assistant_dm: '协作 DM',
  player: '玩家',
  spectator: '旁观者',
};

function RoomList({ rooms, deletingSlug, onOpenRoom, onDeleteRoom }: {
  rooms: RoomSummary[];
  deletingSlug: string | null;
  onOpenRoom: (slug: string) => void;
  onDeleteRoom: (room: RoomSummary) => void;
}) {
  return (
    <ul className="space-y-2">
      {rooms.map(room => (
        <li key={room.id || room.slug} className="flex min-w-0 items-stretch overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/55 transition-colors focus-within:border-amber-500/50 hover:border-amber-500/50 hover:bg-zinc-800/80">
          <button
            type="button"
            onClick={() => onOpenRoom(room.slug)}
            disabled={deletingSlug === room.slug}
            className="group flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`进入房间 ${room.name}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-zinc-100" title={room.name}>{room.name}</span>
              <span className="mt-1 block truncate text-xs text-zinc-500" title={`/r/${room.slug}`}>
                {ROLE_LABELS[room.role ?? ''] ?? room.role ?? '成员'} · /r/{room.slug}
              </span>
            </span>
            <span className="shrink-0 text-sm text-zinc-500 transition-colors group-hover:text-amber-300">进入 →</span>
          </button>
          {room.role === 'host' && (
            <button
              type="button"
              onClick={() => onDeleteRoom(room)}
              disabled={deletingSlug !== null}
              className="m-2 ml-0 shrink-0 rounded-md px-3 text-xs text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`删除房间 ${room.name}`}
            >{deletingSlug === room.slug ? '删除中…' : '删除'}</button>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function Lobby({ inviteError, onOpenRoom, onJoinRoom }: Props) {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [templates, setTemplates] = useState<RoomTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [name, setName] = useState('');
  const [roomEntry, setRoomEntry] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      // `api.me()` establishes the anonymous session cookie before room
      // listing. Do not make these first-visit requests in parallel.
      const user = await api.me();
      const [list, roomTemplates] = await Promise.all([
        api.rooms(),
        api.roomTemplates().catch(() => []),
      ]);
      setMe(user);
      setRooms(list);
      setTemplates(roomTemplates);
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
    if (looksLikeRoomEntry(trimmed)) {
      setError('这看起来是房间地址或邀请链接，请填写到“进入房间”。');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const room = await api.createRoom(trimmed, templateId || undefined);
      onOpenRoom(room.slug);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建房间失败');
    } finally {
      setCreating(false);
    }
  };

  const joinRoom = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = roomEntry.trim();
    if (!trimmed || joining) return;
    setJoining(true);
    setError(null);
    try {
      await onJoinRoom(trimmed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法识别房间信息');
    } finally {
      setJoining(false);
    }
  };

  const removeRoom = async (room: RoomSummary) => {
    if (deletingSlug || room.role !== 'host') return;
    const confirmed = window.confirm(`确定删除房间“${room.name}”吗？\n\n地图、Token、邀请码和房间进度都将被删除，此操作无法撤销。`);
    if (!confirmed) return;
    setDeletingSlug(room.slug);
    setError(null);
    try {
      await api.deleteRoom(room.slug);
      setRooms(current => current.filter(candidate => candidate.slug !== room.slug));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除房间失败');
    } finally {
      setDeletingSlug(null);
    }
  };

  const managedRooms = rooms.filter(room => MANAGER_ROLES.has(room.role ?? ''));
  const joinedRooms = rooms.filter(room => !MANAGER_ROLES.has(room.role ?? ''));

  return (
    <main className="h-full overflow-y-auto bg-zinc-950 px-4 py-6 sm:py-10 md:px-8">
      <div className="mx-auto w-full max-w-5xl">
        <header className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-6 shadow-2xl sm:p-8">
          <p className="text-sm font-medium text-amber-400">DND DM 追踪</p>
          <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">开始或继续一场冒险</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
                从已有房间继续，输入邀请码、粘贴朋友发来的邀请链接，或创建一张新的游戏桌面。
              </p>
            </div>
            {me && (
              <p className="w-fit shrink-0 rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-1.5 text-xs text-zinc-400">
                当前身份：<span className="text-zinc-200">{me.displayName ?? me.id}</span>
              </p>
            )}
          </div>
        </header>

        {(inviteError || error) && (
          <div role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {inviteError || error}
          </div>
        )}

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <section aria-labelledby="my-rooms-heading" className="order-2 min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 sm:p-6 lg:order-1">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2 id="my-rooms-heading" className="text-lg font-semibold">我的房间</h2>
                <p className="mt-1 text-xs text-zinc-500">按你在房间中的职责归档</p>
              </div>
              <button type="button" onClick={() => { void load(); }} disabled={loading} className="shrink-0 text-xs text-zinc-400 hover:text-white disabled:opacity-50">
                {loading ? '读取中…' : '刷新'}
              </button>
            </div>
            {loading ? (
              <p className="rounded-lg border border-dashed border-zinc-800 py-10 text-center text-sm text-zinc-500">正在读取房间…</p>
            ) : rooms.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-800 px-5 py-10 text-center text-sm leading-relaxed text-zinc-500">
                还没有加入任何房间。你可以在右侧输入邀请码或邀请链接，或创建自己的第一个房间。
              </p>
            ) : (
              <div className="space-y-6">
                {managedRooms.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">我管理的</h3>
                    <RoomList rooms={managedRooms} deletingSlug={deletingSlug} onOpenRoom={onOpenRoom} onDeleteRoom={room => { void removeRoom(room); }} />
                  </div>
                )}
                {joinedRooms.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">我加入的</h3>
                    <RoomList rooms={joinedRooms} deletingSlug={deletingSlug} onOpenRoom={onOpenRoom} onDeleteRoom={room => { void removeRoom(room); }} />
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="order-1 space-y-6 lg:order-2">
            <form onSubmit={joinRoom} className="rounded-xl border border-emerald-500/20 bg-zinc-900/80 p-5 sm:p-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300" aria-hidden="true">↗</div>
              <h2 className="mt-4 text-lg font-semibold">进入房间</h2>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">输入邀请码、房间编号，或粘贴本站的房间地址、玩家邀请链接。</p>
              <label className="mt-4 block text-xs text-zinc-400" htmlFor="room-entry">房间信息</label>
              <input
                id="room-entry"
                value={roomEntry}
                onChange={event => setRoomEntry(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="邀请码、房间编号或邀请链接"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2.5 text-sm outline-none transition-colors focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={!roomEntry.trim() || joining}
                className="mt-3 w-full rounded-lg bg-emerald-500/15 px-3 py-2.5 text-sm font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >{joining ? '正在进入…' : '进入房间'}</button>
            </form>

            <form onSubmit={createRoom} className="rounded-xl border border-amber-500/20 bg-zinc-900/80 p-5 sm:p-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-xl text-amber-300" aria-hidden="true">＋</div>
              <h2 className="mt-4 text-lg font-semibold">创建房间</h2>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">你会成为房主，可以管理桌面、地图和玩家邀请。</p>
              <label className="mt-4 block text-xs text-zinc-400" htmlFor="room-name">房间名称</label>
              <input
                id="room-name"
                value={name}
                onChange={event => setName(event.target.value)}
                maxLength={80}
                autoComplete="off"
                placeholder="例如：周五龙与地下城"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2.5 text-sm outline-none transition-colors focus:border-amber-500"
              />
              <label className="mt-4 block text-xs text-zinc-400" htmlFor="room-template">跑团模板</label>
              <select
                id="room-template"
                value={templateId}
                onChange={event => setTemplateId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2.5 text-sm text-zinc-200 outline-none transition-colors focus:border-amber-500"
              >
                <option value="">空白冒险</option>
                {templates.map(template => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
              {templateId && (() => {
                const selected = templates.find(template => template.id === templateId);
                return selected ? (
                  <div className="mt-2 rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-zinc-400">
                    <div className="font-medium text-amber-300">{selected.name}</div>
                    <div className="mt-0.5">{selected.description}</div>
                    <div className="mt-1 text-zinc-500">{selected.sceneCount} 个场景 · {selected.npcCount} 个 NPC 档案</div>
                  </div>
                ) : null;
              })()}
              <button
                type="submit"
                disabled={!name.trim() || creating}
                className="mt-3 w-full rounded-lg bg-amber-500/15 px-3 py-2.5 text-sm font-medium text-amber-300 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >{creating ? '正在创建…' : '创建并进入'}</button>
            </form>
          </aside>
        </div>
      </div>
    </main>
  );
}
