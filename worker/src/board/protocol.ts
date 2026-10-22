import { DomainError, type RoomActor, type RoomRole } from '../domain';

export const INTERNAL_REQUEST_HEADER = 'x-dnd-internal-request';
export const MAX_WS_MESSAGE_BYTES = 64 * 1024;
export const MAX_COMMANDS_PER_MINUTE = 180;

export interface SocketAttachment extends RoomActor {
  version: 1;
  commandWindowStartedAt: number;
  commandCount: number;
  /** New clients opt in after receiving their initial full-state snapshot. */
  supportsPatches?: boolean;
}

export function actorFromHeaders(headers: Headers): RoomActor {
  const userId = headers.get('x-dnd-user-id');
  const memberId = headers.get('x-dnd-member-id');
  const role = headers.get('x-dnd-room-role');
  const accessEpoch = Number(headers.get('x-dnd-access-epoch'));
  const platformOwner = headers.get('x-dnd-platform-owner') === '1';
  const claimedActorId = headers.get('x-dnd-actor-id');
  const claimedActorName = decodedHeader(headers.get('x-dnd-actor-name'));
  const claimedActorAvatar = decodedHeader(headers.get('x-dnd-actor-avatar'));
  const claimedActorColor = headers.get('x-dnd-actor-color');
  if (!userId || !memberId || !isRoomRole(role) || !Number.isInteger(accessEpoch) || accessEpoch < 1) {
    throw new DomainError('FORBIDDEN', '无效的房间身份');
  }
  const claimedActor = claimedActorId && claimedActorName && claimedActorAvatar !== null && claimedActorColor
    ? { id: claimedActorId, name: claimedActorName, avatar: claimedActorAvatar, color: claimedActorColor }
    : undefined;
  return {
    userId, memberId, role, accessEpoch,
    ...(platformOwner ? { platformOwner: true } : {}),
    ...(claimedActor ? { claimedActor } : {}),
  };
}

export function socketActor(socket: WebSocket): SocketAttachment | null {
  const value: unknown = socket.deserializeAttachment();
  if (!isRecord(value) || value.version !== 1 || typeof value.userId !== 'string' || typeof value.memberId !== 'string' || !isRoomRole(value.role)
    || typeof value.accessEpoch !== 'number' || typeof value.commandWindowStartedAt !== 'number' || typeof value.commandCount !== 'number') return null;
  if (value.platformOwner !== undefined && typeof value.platformOwner !== 'boolean') return null;
  if (value.claimedActor !== undefined && (!isRecord(value.claimedActor)
    || typeof value.claimedActor.id !== 'string'
    || typeof value.claimedActor.name !== 'string'
    || typeof value.claimedActor.avatar !== 'string'
    || typeof value.claimedActor.color !== 'string')) return null;
  return value as unknown as SocketAttachment;
}

export function isRoomRole(value: unknown): value is RoomRole {
  return value === 'host' || value === 'dm' || value === 'assistant_dm' || value === 'player' || value === 'spectator';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodedHeader(value: string | null): string | null {
  if (value === null) return null;
  try { return decodeURIComponent(value); } catch { throw new DomainError('FORBIDDEN', '无效的角色身份'); }
}

export async function objectBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new DomainError('INVALID', '请求必须是 JSON 对象');
  }
  if (!isRecord(value)) throw new DomainError('INVALID', '请求必须是 JSON 对象');
  return value;
}

export function text(value: unknown, label: string, maximumLength = 120): string {
  if (typeof value !== 'string') throw new DomainError('INVALID', `${label}无效`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) throw new DomainError('INVALID', `${label}长度无效`);
  return normalized;
}

export function clientCommandId(value: unknown): string {
  if (typeof value === 'string' && value.length > 0 && value.length <= 180) return value;
  return crypto.randomUUID();
}
