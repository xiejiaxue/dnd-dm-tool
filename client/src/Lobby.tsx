import { useEffect, useState, type FormEvent } from 'react';
import { api, type CurrentUser, type RoomSummary } from './api';
import SessionCalculator from './components/SessionCalculator';

interface Props {
  inviteError?: string | null;
  onOpenRoom: (slug: string) => void;
}

function CalculatorDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 sm:p-10"
      onClick={onClose}
      role="presentation"
    >
      <section
        aria-label="桌面计算器"
        className="w-full max-w-xl border border-ink bg-panel shadow-[6px_6px_0_0_rgba(17,17,16,0.2)]"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b-2 border-ink px-5 py-3">
          <div>
            <p className="panel-label">桌面计算器</p>
            <h2 className="font-bold tracking-tight">骰点 · 先攻 · 生命值</h2>
          </div>
          <button onClick={onClose} aria-label="关闭" className="text-faint text-lg leading-none hover:text-accent transition-colors duration-150">✕</button>
        </header>
        <div className="px-5 py-4">
          <SessionCalculator />
        </div>
      </section>
    </div>
  );
}

export default function Lobby({ inviteError, onOpenRoom }: Props) {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);

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
    <main className="h-full overflow-y-auto bg-paper">
      <section className="w-full max-w-3xl m-auto px-6 py-12">
        <header>
          <p className="panel-label">桌面跑团 · D&amp;D 5E</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">DM 追踪</h1>
          {me && <p className="mt-3 text-xs text-muted">当前身份：{me.displayName ?? me.id}</p>}
        </header>
        <div aria-hidden className="mt-5 h-[3px] bg-ink" />

        <div className="grid gap-10 md:grid-cols-[1fr_0.9fr] md:gap-0 pt-8">
          <div className="md:pr-10">
            <div className="flex items-center justify-between mb-3">
              <h2 className="panel-label">我的房间</h2>
              <button onClick={() => { void load(); }} className="text-xs text-muted hover:text-accent transition-colors duration-150">刷新</button>
            </div>
            {loading ? (
              <p className="text-sm text-muted py-4">正在读取房间…</p>
            ) : rooms.length === 0 ? (
              <p className="text-sm text-muted py-4">暂无房间</p>
            ) : (
              <ul>
                {rooms.map(room => (
                  <li key={room.id || room.slug} className="border-b border-line">
                    <button
                      onClick={() => onOpenRoom(room.slug)}
                      className="group w-full text-left py-3 px-1 hover:bg-panel transition-colors duration-150"
                    >
                      <span className="block font-medium truncate">{room.name}</span>
                      <span className="block mt-1 text-xs text-muted">
                        {room.role ? `权限：${room.role}` : '进入桌面'} · /r/{room.slug}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={createRoom} className="h-fit md:border-l md:border-line md:pl-10">
            <h2 className="panel-label">创建房间</h2>
            <label className="block mt-5 text-xs text-muted" htmlFor="room-name">房间名称</label>
            <input
              id="room-name"
              value={name}
              onChange={event => setName(event.target.value)}
              maxLength={80}
              autoComplete="off"
              placeholder="例如：周五龙与地下城"
              className="field mt-1.5"
            />
            <button
              type="submit"
              disabled={!name.trim() || creating}
              className="btn-accent mt-4 w-full"
            >{creating ? '正在创建…' : '创建并进入'}</button>
          </form>
        </div>

        {(inviteError || error) && (
          <div className="mt-8 border border-line border-l-4 border-l-accent bg-panel px-3 py-2 text-sm text-accent">
            {inviteError || error}
          </div>
        )}

        <div className="mt-12 border-t border-line pt-6">
          <button
            onClick={() => setCalcOpen(true)}
            className="group flex w-full items-center justify-between gap-4 border border-line bg-panel px-4 py-3 text-left transition-colors duration-150 hover:border-ink"
          >
            <span>
              <span className="block font-medium">桌面计算器</span>
              <span className="mt-0.5 block text-xs text-muted">骰点、先攻排序与生命值追踪（数据保存在本机）</span>
            </span>
            <span aria-hidden className="text-lg text-faint transition-colors duration-150 group-hover:text-ink">→</span>
          </button>
        </div>
      </section>
      {calcOpen && <CalculatorDialog onClose={() => setCalcOpen(false)} />}
    </main>
  );
}
