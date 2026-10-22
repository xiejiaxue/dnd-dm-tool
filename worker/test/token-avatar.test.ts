import { describe, expect, it } from 'vitest';
import { authorizeOperation, createInitialRoomState, type RoomActor } from '../src/domain';

const host: RoomActor = { userId: 'host-user', memberId: 'host-member', role: 'host', accessEpoch: 1 };

const state = () => createInitialRoomState('Avatar table', 'Avatar campaign');

const tokenOp = (avatar: unknown) => ({
  op: 'addToken' as const,
  token: { id: 't1', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 0, y: 0, size: 100, avatar, color: '#fff' },
});

describe('addToken avatar authorization', () => {
  it('accepts shared compendium portrait routes', () => {
    const authorized = authorizeOperation(tokenOp('/api/token/MM__Goblin'), state(), host);
    expect(authorized).toMatchObject({ op: 'addToken', token: { avatar: '/api/token/MM__Goblin' } });
  });

  it('accepts room-private asset routes and explicit blanks', () => {
    const roomAsset = authorizeOperation(tokenOp('/api/rooms/r1/assets/a1'), state(), host);
    expect(roomAsset).toMatchObject({ token: { avatar: '/api/rooms/r1/assets/a1' } });
    const blank = authorizeOperation(tokenOp(''), state(), host);
    expect(blank).toMatchObject({ token: { avatar: '' } });
  });

  it('rejects external and non-room URLs', () => {
    for (const avatar of ['https://cdn.example.com/goblin.png', 'javascript:alert(1)', '/api/other/leak']) {
      expect(() => authorizeOperation(tokenOp(avatar), state(), host)).toThrow();
    }
  });
});
