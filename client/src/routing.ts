export interface InitialNavigation {
  roomSlug: string | null;
  inviteToken: string | null;
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
  return token || null;
}

/**
 * A URL carrying an invite token must not boot the room before redemption.
 * Otherwise its first permission check can race the session-bound redemption.
 */
export function initialNavigation(pathname: string, hash: string): InitialNavigation {
  const inviteToken = inviteTokenFromHash(hash);
  return { inviteToken, roomSlug: inviteToken ? null : roomSlugFromPath(pathname) };
}
