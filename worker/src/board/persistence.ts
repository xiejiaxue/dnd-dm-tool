import type { PersistedRoomState } from '../domain';

type RoomSql = DurableObjectStorage['sql'];

interface StateRow {
  [key: string]: string | number | null | ArrayBuffer;
  revision: number;
  data_json: string;
}

export interface CommandReceipt {
  [key: string]: string | number | null | ArrayBuffer;
  revision: number;
  result_json: string;
}

export interface RoomMutationWrite {
  state: PersistedRoomState;
  actorMemberId: string;
  commandId: string;
  action: string;
  event: unknown;
  result: unknown;
  now: number;
}

export function createRoomSchema(sql: RoomSql): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS room_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      revision INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS room_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_member_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (actor_member_id, command_id)
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS room_command_receipts (
      actor_member_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (actor_member_id, command_id)
    )
  `);
}

export function loadRoomState(sql: RoomSql): PersistedRoomState | null {
  const row = sql.exec<StateRow>('SELECT revision, data_json FROM room_state WHERE singleton = 1').toArray()[0];
  if (!row) return null;
  const state = JSON.parse(row.data_json) as PersistedRoomState;
  if (state.schemaVersion !== 1 || typeof state.revision !== 'number') throw new Error('Unsupported room state');
  return state;
}

export function findCommandReceipt(sql: RoomSql, actorMemberId: string, commandId: string): CommandReceipt | undefined {
  return sql.exec<CommandReceipt>(
    'SELECT revision, result_json FROM room_command_receipts WHERE actor_member_id = ?1 AND command_id = ?2',
    actorMemberId,
    commandId,
  ).toArray()[0];
}

/** Call inside the Durable Object's transactionSync boundary. */
export function writeRoomMutation(sql: RoomSql, write: RoomMutationWrite): void {
  sql.exec(
    `INSERT INTO room_state (singleton, revision, data_json, updated_at)
     VALUES (1, ?1, ?2, ?3)
     ON CONFLICT(singleton) DO UPDATE SET revision = excluded.revision, data_json = excluded.data_json, updated_at = excluded.updated_at`,
    write.state.revision,
    JSON.stringify(write.state),
    write.now,
  );
  sql.exec(
    'INSERT INTO room_events (actor_member_id, command_id, action, payload_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    write.actorMemberId,
    write.commandId,
    write.action,
    JSON.stringify(write.event),
    write.now,
  );
  sql.exec(
    `INSERT INTO room_command_receipts (actor_member_id, command_id, revision, result_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
    write.actorMemberId,
    write.commandId,
    write.state.revision,
    JSON.stringify(write.result),
    write.now,
  );
}

/** Call inside the Durable Object's transactionSync boundary. */
export function writeInitialRoomState(sql: RoomSql, state: PersistedRoomState, now: number): void {
  sql.exec(
    'INSERT INTO room_state (singleton, revision, data_json, updated_at) VALUES (1, ?1, ?2, ?3)',
    state.revision,
    JSON.stringify(state),
    now,
  );
  sql.exec(
    'INSERT INTO room_events (actor_member_id, command_id, action, payload_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    'system',
    'room.initialize',
    'room.initialize',
    JSON.stringify({ revision: state.revision, occurredAt: now }),
    now,
  );
}

/** Persist a backwards-compatibility cleanup without advancing the public
 * room revision or manufacturing a user-authored event. */
export function writeNormalizedRoomState(sql: RoomSql, state: PersistedRoomState, now: number): void {
  sql.exec(
    'UPDATE room_state SET data_json = ?1, updated_at = ?2 WHERE singleton = 1',
    JSON.stringify(state),
    now,
  );
}
