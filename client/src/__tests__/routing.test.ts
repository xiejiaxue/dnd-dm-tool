import { describe, expect, it } from 'vitest';
import { initialNavigation } from '../routing';

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
