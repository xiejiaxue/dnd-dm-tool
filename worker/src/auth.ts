import { HttpError } from './http';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export interface Session {
  id: string;
  userId: string;
  displayName: string;
}

export interface SessionContext {
  session: Session;
  setCookie?: string;
}

interface SessionRow {
  session_id: string;
  user_id: string;
  display_name: string;
}

export async function getOrCreateSession(env: Env, request: Request): Promise<SessionContext> {
  const token = readCookie(request, '__Host-dnd-session') ?? readCookie(request, 'dnd_session');
  const now = Date.now();
  if (token) {
    const row = await env.DB.prepare(
      `SELECT s.id AS session_id, s.user_id, u.display_name
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?1
         AND s.revoked_at IS NULL
         AND s.expires_at > ?2
         AND u.status = 'active'`,
    ).bind(await sha256Hex(token), now).first<SessionRow>();
    if (row) {
      return { session: { id: row.session_id, userId: row.user_id, displayName: row.display_name } };
    }
  }

  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const rawToken = randomToken(32);
  const displayName = `访客 ${randomToken(3).toUpperCase()}`;
  const expiresAt = now + SESSION_TTL_MS;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)')
      .bind(userId, displayName, now),
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, user_id, token_hash, issued_at, expires_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?4)`,
    ).bind(sessionId, userId, await sha256Hex(rawToken), now, expiresAt),
  ]);

  return {
    session: { id: sessionId, userId, displayName },
    setCookie: sessionCookie(request, rawToken),
  };
}

export async function revokeCurrentSession(env: Env, session: Session): Promise<void> {
  await env.DB.prepare('UPDATE auth_sessions SET revoked_at = ?1, revoke_reason = ?2 WHERE id = ?3')
    .bind(Date.now(), 'user_logout', session.id)
    .run();
}

export async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes: number): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  let binary = '';
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const item of header.split(';')) {
    const [rawName, ...rawValue] = item.trim().split('=');
    if (rawName === name) return rawValue.join('=');
  }
  return undefined;
}

function sessionCookie(request: Request, token: string): string {
  const secure = new URL(request.url).protocol === 'https:';
  const name = secure ? '__Host-dnd-session' : 'dnd_session';
  const attributes = [
    `${name}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1_000)}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function requireSession(context: SessionContext | undefined): asserts context is SessionContext {
  if (!context) throw new HttpError(401, 'AUTH_REQUIRED', '需要登录');
}
