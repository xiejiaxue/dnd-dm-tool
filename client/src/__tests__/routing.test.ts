import { describe, expect, it } from 'vitest';
import { initialNavigation, inviteCodeFromText, looksLikeRoomEntry, parseRoomEntry } from '../routing';

describe('initial room navigation', () => {
  it('defers room bootstrap while an invite fragment is present', () => {
    expect(initialNavigation('/r/private-room', '#invite=one-time-token')).toEqual({
      roomSlug: null,
      inviteToken: 'one-time-token',
    });
  });

  it('opens a normal room route immediately', () => {
    expect(initialNavigation('/r/private-room', '')).toEqual({
      roomSlug: 'private-room',
      inviteToken: null,
    });
  });
});

describe('lobby room entry parsing', () => {
  const origin = 'https://dnd.xiejiaxue.com';

  it('accepts a room code', () => {
    expect(parseRoomEntry('test-fmsathq', origin)).toEqual({
      roomSlug: 'test-fmsathq',
      inviteToken: null,
    });
  });

  it('accepts a reusable invite code without requiring a room URL', () => {
    expect(inviteCodeFromText('abcd efgh-jklm npqr')).toBe('ABCD-EFGH-JKLM-NPQR');
    expect(parseRoomEntry('abcd efgh-jklm npqr', origin)).toEqual({
      roomSlug: null,
      inviteToken: 'ABCD-EFGH-JKLM-NPQR',
    });
    expect(parseRoomEntry('#invite=abcd-efgh-jklm-npqr', origin)).toEqual({
      roomSlug: null,
      inviteToken: 'ABCD-EFGH-JKLM-NPQR',
    });
  });

  it('accepts same-site absolute and relative room addresses', () => {
    expect(parseRoomEntry('https://dnd.xiejiaxue.com/r/test-fmsathq', origin)).toEqual({
      roomSlug: 'test-fmsathq',
      inviteToken: null,
    });
    expect(parseRoomEntry('r/test-fmsathq', origin)).toEqual({
      roomSlug: 'test-fmsathq',
      inviteToken: null,
    });
  });

  it('keeps the room hint and invite token from an invitation', () => {
    expect(parseRoomEntry('/r/test-fmsathq#invite=one-time-token', origin)).toEqual({
      roomSlug: 'test-fmsathq',
      inviteToken: 'one-time-token',
    });
  });

  it('supports token-only legacy invitation fragments', () => {
    expect(parseRoomEntry('#invite=legacy-token', origin)).toEqual({
      roomSlug: null,
      inviteToken: 'legacy-token',
    });
  });

  it('rejects foreign, malformed, and unrelated addresses', () => {
    expect(parseRoomEntry('https://example.com/r/test-fmsathq#invite=stolen', origin)).toBeNull();
    expect(parseRoomEntry('not a room', origin)).toBeNull();
    expect(parseRoomEntry('/settings', origin)).toBeNull();
  });

  it('recognizes pasted room references before room creation', () => {
    expect(looksLikeRoomEntry('https://dnd.xiejiaxue.com/r/test-fmsathq')).toBe(true);
    expect(looksLikeRoomEntry('/r/test-fmsathq#invite=token')).toBe(true);
    expect(looksLikeRoomEntry('ABCD-EFGH-JKLM-NPQR')).toBe(true);
    expect(looksLikeRoomEntry('周五龙与地下城')).toBe(false);
  });
});
