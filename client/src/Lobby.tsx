import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type CurrentUser, type RoomSummary, type RoomTemplateSummary } from './api';
import type { StandalonePageRegistration } from './extensions/registry';
import Icon, { DiceArtwork } from './components/Icon';
import { looksLikeRoomEntry } from './routing';

interface Props {
  inviteError?: string | null;
  standalonePages: StandalonePageRegistration[];
  onOpenStandalonePage: (path: string) => void;
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
  return <div className="room-grid">{rooms.map(room => <div className="room-card-wrapper" key={room.id || room.slug}>
    <a className="room-card" href={`/r/${encodeURIComponent(room.slug)}`} aria-disabled={deletingSlug === room.slug} onClick={event => {
      if (deletingSlug === room.slug) { event.preventDefault(); return; }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault(); onOpenRoom(room.slug);
    }} aria-label={`进入房间 ${room.name}`}>
      <div className="room-card-top"><span className={`visibility ${MANAGER_ROLES.has(room.role ?? '') ? 'host' : ''}`}><span/>{room.platformReadOnly ? '平台只读' : ROLE_LABELS[room.role ?? ''] ?? '成员'}</span></div>
      <h3>{room.name}</h3><p className="room-slug">ROOM / {room.slug}</p>
      <div className="chip-row"><span className="chip">{room.platformReadOnly ? '只读浏览' : MANAGER_ROLES.has(room.role ?? '') ? '主持与管理' : '参与冒险'}</span><span className="chip">游戏桌面</span></div>
      <footer><span>你的故事，随时继续</span><span className="room-enter">进入房间 <Icon name="arrow"/></span></footer>
    </a>
    {room.role === 'host' && <button className="room-delete" type="button" onClick={() => onDeleteRoom(room)} disabled={deletingSlug !== null} aria-label={`删除房间 ${room.name}`}>{deletingSlug === room.slug ? '删除中…' : '删除'}</button>}
  </div>)}</div>;
}

export default function Lobby({ inviteError, standalonePages, onOpenStandalonePage, onOpenRoom, onJoinRoom }: Props) {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [templates, setTemplates] = useState<RoomTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const nameRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
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

  const focusField = (field: HTMLInputElement | null) => {
    field?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
    field?.focus({ preventScroll: true });
  };
  const visibleRooms = rooms.filter(room => `${room.name} ${room.slug}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const managedRooms = visibleRooms.filter(room => !room.platformReadOnly && MANAGER_ROLES.has(room.role ?? ''));
  const platformRooms = visibleRooms.filter(room => room.platformReadOnly);
  const joinedRooms = visibleRooms.filter(room => !room.platformReadOnly && !MANAGER_ROLES.has(room.role ?? ''));
  const filteredRooms = filter === 'host' ? managedRooms : filter === 'joined' ? joinedRooms : visibleRooms;
  const hasFilter = Boolean(query.trim()) || filter !== 'all';
  const hosted = rooms.filter(room => !room.platformReadOnly && MANAGER_ROLES.has(room.role ?? '')).length;
  const selectedTemplate = templates.find(template => template.id === templateId);
  const roomList = (list: RoomSummary[]) => <RoomList rooms={list} deletingSlug={deletingSlug} onOpenRoom={onOpenRoom} onDeleteRoom={room => { void removeRoom(room); }}/>;
  return (
    <div className="swiss-lobby">
      <a className="skip-link" href="#room-directory">跳转到房间列表</a>
      <aside className="navigation-rail">
        <button className="brand-mark" onClick={() => pageRef.current?.scrollTo({ top: 0 })} aria-label="DM 追踪首页"><span className="brand-symbol"><Icon name="dice"/></span><span>DM<span className="brand-second">追踪</span></span></button>
        <div className="nav-caption">冒险工作空间 / WORKSPACE</div>
        <nav aria-label="主导航">
          <button className="rail-destination active" aria-current="page" onClick={() => pageRef.current?.scrollTo({ top: 0 })}><Icon name="grid"/><span>冒险大厅</span><span className="nav-index">01</span></button>
          <button className="rail-destination" onClick={() => focusField(searchRef.current)}><Icon name="users"/><span>我的房间</span><span className="nav-index">02</span></button>
          {standalonePages.map(page => <button key={page.id} className="rail-destination" onClick={() => onOpenStandalonePage(page.path)}><Icon name="dice"/><span>角色卡</span><span className="nav-index">03</span></button>)}
        </nav>
        <div className="rail-note"><span className="tiny-label">MADE FOR YOUR STORIES</span><p>每一次掷骰，<br/>都是故事的开始。</p><span className="rail-note-mark" aria-hidden="true">✳</span></div>
        <div className="rail-account"><span className="avatar"><Icon name="users"/></span><div><strong>{me?.displayName || '冒险者'}</strong><small>{loading ? '正在连接…' : me?.platformRole === 'owner' ? '平台所有者' : me ? '已连接 · 游客身份' : '连接未完成'}</small></div></div>
      </aside>
      <div className="lobby-scroll" ref={pageRef}>
        <header className="app-topbar"><span>DM 追踪 <span className="breadcrumb-divider">/</span> <strong>冒险大厅</strong></span><span className="topbar-note">一起创造，下一个故事。<span className="status-dot"/></span></header>
        <main className="lobby-main">
          <section className="lobby-hero"><div className="hero-copy"><span className="eyebrow">01 / THE ADVENTURE LOBBY</span><h1>下一场冒险，<br/>从这里开始<span className="accent">。</span></h1><p>召集伙伴，铺开地图。把想象中的世界，变成共同的故事。</p><div className="hero-actions"><button className="button-primary" onClick={() => focusField(nameRef.current)}><Icon name="plus"/> 创建房间</button><button className="text-link" onClick={() => focusField(searchRef.current)}>继续我的冒险 <Icon name="arrow"/></button></div></div><DiceArtwork/></section>
          <div className="lobby-meta"><span><b>{String(rooms.filter(room => !room.platformReadOnly).length).padStart(2, '0')}</b> 我的房间</span><span><b>{String(hosted).padStart(2, '0')}</b> 我主持的</span><span className="meta-note">你的想象，就是边界。</span></div>
          {(inviteError || error) && <div className="lobby-error" role="alert"><span>{inviteError || error}</span>{error && <button disabled={loading} onClick={() => void load()}>重新读取</button>}</div>}
          <div className="lobby-layout">
            <section id="room-directory" tabIndex={-1} aria-label="我的房间">
              <div className="section-title"><span className="section-number">01</span><h2>我的房间</h2><span className="count" role="status">{filteredRooms.length}</span><button className="refresh-button" disabled={loading} onClick={() => void load()} aria-label="刷新房间列表"><Icon name="refresh"/> {loading ? '读取中' : '刷新'}</button></div>
              <label className="search-field"><Icon name="search"/><input ref={searchRef} type="search" aria-label="搜索房间" placeholder="搜索房间名称或编号…" value={query} onChange={event => setQuery(event.target.value)}/></label>
              <div className="room-filters" aria-label="筛选房间">{[['all', '全部房间'], ['host', '我管理的'], ['joined', '我加入的']].map(([value, label]) => <button key={value} aria-pressed={filter === value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{label}</button>)}<span className="section-english">YOUR ADVENTURES</span></div>
              {loading ? <div className="empty-state" role="status"><Icon name="refresh"/><h3>正在寻找你的冒险…</h3><p>正在读取已加入的房间。</p></div> : filteredRooms.length ? filter !== 'all' ? roomList(filteredRooms) : <>
                {managedRooms.length > 0 && <><h3 className="room-group-heading">我管理的 / HOSTING</h3>{roomList(managedRooms)}</>}
                {joinedRooms.length > 0 && <><h3 className="room-group-heading">我加入的 / PLAYING</h3>{roomList(joinedRooms)}</>}
                {platformRooms.length > 0 && <><h3 className="room-group-heading">全站房间 · 只读 / PLATFORM</h3>{roomList(platformRooms)}</>}
              </> : <div className="empty-state"><Icon name="dice"/><h3>{hasFilter ? '没有找到匹配的房间' : '下一段故事，等你开场'}</h3><p>{hasFilter ? '试试其他关键词，或查看全部房间。' : '创建一间房间，或通过邀请加入伙伴的游戏。'}</p><button className="button-secondary" onClick={() => { if (hasFilter) { setQuery(''); setFilter('all'); } else focusField(nameRef.current); }}>{hasFilter ? '清除筛选' : <><Icon name="plus"/> 创建第一间房间</>}</button></div>}
              {standalonePages.map(page => <section key={page.id} className="character-entry"><span className="eyebrow">CHARACTER / 角色档案</span><h2>{page.label}</h2><p>{page.description}</p><button className="button-secondary" onClick={() => onOpenStandalonePage(page.path)}>打开角色卡 <Icon name="arrow"/></button></section>)}
            </section>
            <aside className="lobby-utilities">
              <section className="create-room"><div className="create-heading"><span className="eyebrow">NEW ADVENTURE</span><Icon name="plus"/></div><h2>创建你的房间</h2><p className="form-intro">一张新游戏桌，一个新世界。</p><form onSubmit={createRoom}>
                <label htmlFor="room-name">房间名称</label><input ref={nameRef} id="room-name" value={name} onChange={event => setName(event.target.value)} maxLength={80} required autoComplete="off" placeholder="例如：周五的龙与地下城" aria-describedby="room-name-hint"/>
                <label htmlFor="room-template">跑团模板</label><select id="room-template" value={templateId} onChange={event => setTemplateId(event.target.value)}><option value="">空白冒险</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select>
                {selectedTemplate && <div className="template-preview"><strong>{selectedTemplate.name}</strong><p>{selectedTemplate.description}</p><p>{selectedTemplate.sceneCount} 个场景 · {selectedTemplate.npcCount} 个 NPC 档案</p></div>}
                <p id="room-name-hint" className="field-hint">你将成为房主，可以管理地图、桌面与玩家邀请。</p><button type="submit" className="button-primary" disabled={!name.trim() || creating || loading}>{creating ? '正在创建…' : '创建并进入'}<Icon name="arrow"/></button>
              </form></section>
              <form className="join-room" onSubmit={joinRoom}><span className="eyebrow">JOIN THE TABLE</span><h2>已有邀请？即刻落座。</h2><p>输入邀请码、房间编号，或粘贴本站邀请链接。</p><label htmlFor="room-entry">房间信息</label><input id="room-entry" value={roomEntry} onChange={event => setRoomEntry(event.target.value)} autoComplete="off" spellCheck={false} placeholder="邀请码、房间编号或邀请链接" required/><button className="button-secondary" type="submit" disabled={!roomEntry.trim() || joining}>{joining ? '正在进入…' : '进入房间'}<Icon name="arrow"/></button></form>
            </aside>
          </div>
          <footer className="page-footer"><span>DM 追踪 / 为共同的故事而造</span><span>想象无界 · 冒险继续 <Icon name="arrow"/></span></footer>
        </main>
      </div>
    </div>
  );
}
