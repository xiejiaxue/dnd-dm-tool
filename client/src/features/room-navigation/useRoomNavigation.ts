import { useCallback, useEffect, useRef, useState } from 'react';
import { api, setCurrentRoomSlug, type InviteResult } from '../../api';
import { initialNavigation, parseRoomEntry } from '../../routing';
import { connection } from '../../ws';

export interface RoomNavigationState {
  roomSlug: string | null;
  inviteToken: string | null;
  inviteError: string | null;
  enterRoom: (slug: string, replace?: boolean) => void;
  leaveRoom: () => void;
  joinRoom: (value: string) => void;
}

function roomSlugFromInvite(result: InviteResult): string | null {
  return result.roomSlug ?? result.room?.slug ?? null;
}

/**
 * Browser navigation and invite redemption state machine. The application
 * shell consumes this small interface without knowing URL or auth details.
 */
export function useRoomNavigation(): RoomNavigationState {
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
    setInviteError(null);
  }, []);

  const joinRoom = useCallback((value: string) => {
    const target = parseRoomEntry(value, location.origin);
    if (!target) {
      throw new Error('无法识别房间信息，请输入邀请码、房间编号或本站的房间 / 邀请链接。');
    }

    if (!target.inviteToken) {
      if (!target.roomSlug) throw new Error('房间地址中缺少房间编号。');
      enterRoom(target.roomSlug);
      return;
    }

    connection.disconnect();
    setCurrentRoomSlug(null);
    redeemedInvite.current = null;
    const roomPath = target.roomSlug ? `/r/${encodeURIComponent(target.roomSlug)}` : '/';
    history.pushState(null, '', `${roomPath}#invite=${encodeURIComponent(target.inviteToken)}`);
    setInviteError(null);
    setRoomSlug(null);
    setInviteToken(target.inviteToken);
  }, [enterRoom]);

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

  // Invite credentials live in the fragment and are cleared before the async
  // request, so StrictMode effect replay cannot redeem one credential twice.
  useEffect(() => {
    if (!inviteToken || redeemedInvite.current === inviteToken) return;
    redeemedInvite.current = inviteToken;
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    void api.me()
      .then(() => api.redeemInvite(inviteToken))
      .then(result => {
        const slug = roomSlugFromInvite(result);
        if (!slug) throw new Error('邀请响应没有包含房间地址');
        enterRoom(slug, true);
      })
      .catch(cause => {
        history.replaceState(null, '', '/');
        setCurrentRoomSlug(null);
        setRoomSlug(null);
        setInviteError(cause instanceof Error ? cause.message : '邀请链接无效或已失效');
        setInviteToken(current => current === inviteToken ? null : current);
      });
  }, [enterRoom, inviteToken]);

  return { roomSlug, inviteToken, inviteError, enterRoom, leaveRoom, joinRoom };
}
