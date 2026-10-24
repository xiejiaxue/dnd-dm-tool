import { useEffect, useRef, useState } from 'react';
import { connection, useScene } from '../ws';
import { useInvite } from '../hooks/useInvite';
import { useMapUpload } from '../hooks/useMapUpload';
import BackupTransfer from './BackupTransfer';
import SceneSwitcher from './SceneSwitcher';
import CampaignMembers from './CampaignMembers';
import CharacterSheetPanel from './CharacterSheetPanel';
import CampaignIcon from './CampaignIcon';

interface Props {
  roomName?: string;
  roomSlug?: string;
  onLeaveRoom?: () => void;
  encounterOpen?: boolean;
  onToggleEncounter?: () => void;
  queryOpen?: boolean;
  onToggleQuery?: () => void;
}

const roleLabel: Record<string, string> = { host: '主持人', owner: '主持人', dm: 'DM', assistant_dm: '协作 DM', co_dm: '协作 DM', player: '玩家', spectator: '旁观者' };

export default function TopBar({ roomName, roomSlug, onLeaveRoom, encounterOpen, onToggleEncounter, queryOpen, onToggleQuery }: Props) {
  const { scene, role, roomRole, online, campaign, connected, revoked } = useScene();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [characterSheetOpen, setCharacterSheetOpen] = useState(false);
  const { inviteMessage, setInviteMessage, creatingInvite, createInvite } = useInvite();
  const { uploadingMap, fileRef, onMapPicked } = useMapUpload(setInviteMessage);
  const headerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const isDm = role === 'dm';

  useEffect(() => {
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key !== 'Escape' : headerRef.current?.contains(event.target as Node)) return;
      if (menuRef.current) menuRef.current.open = false;
      setSwitcherOpen(false);
      setMembersOpen(false);
      setCharacterSheetOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, []);

  // A rejected command is rolled back locally; say why instead of leaving the
  // DM to guess from a token snapping back.
  useEffect(() => connection.onMessage(msg => {
    if (msg.type === 'error' && typeof msg.message === 'string') setInviteMessage(msg.message);
  }), [setInviteMessage]);

  return (
    <header className="campaign-header" ref={headerRef}>
      <div className="campaign-identity">
        <span className="campaign-brand" title="DM 追踪"><CampaignIcon name="dice" /></span>
        <div className="campaign-title">
          <strong title={campaign?.name ?? roomName}>{campaign?.name ?? roomName ?? roomSlug ?? '战役'}</strong>
          {isDm ? <button className="campaign-scene-link" aria-expanded={switcherOpen} aria-label="管理场景" onClick={() => { setSwitcherOpen(!switcherOpen); setMembersOpen(false); setCharacterSheetOpen(false); if (menuRef.current) menuRef.current.open = false; }}><span>{scene?.name ?? '连接中…'}</span><CampaignIcon name="chevron" /></button> : <span className="campaign-scene-name">{scene?.name ?? '连接中…'}</span>}
        </div>
        <span className="campaign-role">{roleLabel[roomRole] ?? roomRole}</span>
      </div>
      <div className="campaign-header-actions">
        <span className={`campaign-connection ${connected ? 'is-connected' : ''}`} role="status"><i aria-hidden="true" />{connected ? `在线玩家 ${online}` : revoked ? '已断开' : scene ? '重连中…' : '连接中'}</span>
        {onToggleEncounter && <button className="btn-quiet campaign-panel-toggle" aria-pressed={encounterOpen} aria-controls="campaign-encounter" onClick={onToggleEncounter}><CampaignIcon name="actors" />遭遇</button>}
        {onToggleQuery && <button className="btn-quiet campaign-panel-toggle" aria-pressed={queryOpen} aria-controls="campaign-query" onClick={onToggleQuery}><CampaignIcon name="library" />资料</button>}
        {roomRole === 'player' && <button className="btn-quiet" onClick={() => { setCharacterSheetOpen(!characterSheetOpen); setSwitcherOpen(false); setMembersOpen(false); }}>角色卡</button>}
        {isDm && <>
          <button className="btn-quiet campaign-upload" disabled={uploadingMap} onClick={() => fileRef.current?.click()} title="上传地图底图"><CampaignIcon name="map" />{uploadingMap ? '上传中…' : '上传地图'}</button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onMapPicked} />
          <button className="btn-accent" disabled={creatingInvite} onClick={() => { void createInvite(); }} title="创建玩家邀请链接">{creatingInvite ? '创建中…' : '邀请玩家'}</button>
        </>}
        <details className="campaign-management" ref={menuRef}>
          <summary className="btn-quiet" aria-label="战役管理"><CampaignIcon name="settings" /><span>管理</span></summary>
          <div className="campaign-management-menu"><a className="btn-quiet" href="/dice" target="_blank" rel="noopener">掷骰</a><a className="btn-quiet" href="/calculator" target="_blank" rel="noopener">先攻 / HP 计算器</a><a className="btn-quiet" href="/characters" target="_blank" rel="noopener">角色卡工作台</a>
            {isDm && <><span className="panel-label">战役管理</span><button className="btn-quiet" onClick={() => { setMembersOpen(!membersOpen); setSwitcherOpen(false); setCharacterSheetOpen(false); if (menuRef.current) menuRef.current.open = false; }}>战役名册</button><BackupTransfer /></>}
            {onLeaveRoom && <button className="btn-quiet" onClick={onLeaveRoom}><CampaignIcon name="back" />返回大厅</button>}
          </div>
        </details>
      </div>
      {switcherOpen && <div className="campaign-scene-popover"><SceneSwitcher onClose={() => setSwitcherOpen(false)} /></div>}
      {membersOpen && <div className="campaign-storage-popover"><CampaignMembers role={roomRole} onClose={() => setMembersOpen(false)} /></div>}
      {characterSheetOpen && <CharacterSheetPanel onClose={() => setCharacterSheetOpen(false)} />}
      {inviteMessage && <div className="campaign-notice" role="status"><span>{inviteMessage}</span><button onClick={() => setInviteMessage(null)} aria-label="关闭提示"><CampaignIcon name="close" /></button></div>}
    </header>
  );
}
