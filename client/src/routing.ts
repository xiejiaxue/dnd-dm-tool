export interface InitialNavigation {
  roomSlug: string | null;
  inviteToken: string | null;
}

export interface RoomEntryTarget {
  roomSlug: string | null;
  inviteToken: string | null;
}

const ROOM_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{2,119}$/i;
const INVITE_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{16}$/i;

/** Normalize a human-entered code, accepting spaces, hyphens, and lower case. */
export function inviteCodeFromText(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/[\s-]/gu, '');
  if (!INVITE_CODE_PATTERN.test(compact)) return null;
  return compact.match(/.{1,4}/g)?.join('-') ?? compact;
}

export function roomSlugFromPath(pathname: string): string | null {
  const match = /^\/r\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function inviteTokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('invite')?.trim();
  return token ? inviteCodeFromText(token) ?? token : null;
}

/**
 * Accept the forms people naturally paste into the lobby while keeping invite
 * credentials restricted to this site. A room address does not itself grant
 * access; an invite fragment is redeemed by App before the room is mounted.
 */
export function parseRoomEntry(value: string, siteOrigin: string): RoomEntryTarget | null {
  const raw = value.trim();
  if (!raw) return null;

  const inviteCode = inviteCodeFromText(raw);
  if (inviteCode) return { roomSlug: null, inviteToken: inviteCode };

  if (ROOM_SLUG_PATTERN.test(raw)) {
    return { roomSlug: raw, inviteToken: null };
  }

  let base: URL;
  try {
    base = new URL(siteOrigin);
  } catch {
    return null;
  }

  let candidate = raw;
  if (candidate.startsWith(`${base.host}/`)) candidate = `${base.protocol}//${candidate}`;
  else if (/^r\//i.test(candidate)) candidate = `/${candidate}`;
  else if (candidate.startsWith('#')) candidate = `/${candidate}`;

  let url: URL;
  try {
    url = new URL(candidate, base);
  } catch {
    return null;
  }

  if (url.origin !== base.origin) return null;

  const roomSlug = roomSlugFromPath(url.pathname);
  const inviteToken = inviteTokenFromHash(url.hash);
  if (roomSlug && !ROOM_SLUG_PATTERN.test(roomSlug)) return null;
  if (!roomSlug && !inviteToken) return null;

  return { roomSlug, inviteToken };
}

export function looksLikeRoomEntry(value: string): boolean {
  const raw = value.trim();
  return inviteCodeFromText(raw) !== null || /^(?:https?:\/\/|\/?r\/|#invite=)/i.test(raw) || /#invite=/i.test(raw);
}

/**
 * A URL carrying an invite token must not boot the room before redemption.
 * Otherwise its first permission check can race the session-bound redemption.
 */
export function initialNavigation(pathname: string, hash: string): InitialNavigation {
  const inviteToken = inviteTokenFromHash(hash);
  return { inviteToken, roomSlug: inviteToken ? null : roomSlugFromPath(pathname) };
}
