import { describe, expect, it } from 'vitest';
import {
  canReadDocument,
  canSeeDocument,
  canUpdateDocument,
  documentOwnershipLevel,
  documentUuid,
  normalizeDocumentOwnership,
  type DocumentOwnership,
} from '../types';

const ownership: DocumentOwnership = {
  default: 'limited',
  users: {
    'player-owner': 'owner',
    'player-observer': 'observer',
    'player-hidden': 'none',
  },
};

describe('document permissions', () => {
  it('applies explicit user ownership before the default', () => {
    expect(documentOwnershipLevel(ownership, { userId: 'player-owner', roomRole: 'player' })).toBe('owner');
    expect(documentOwnershipLevel(ownership, { userId: 'player-hidden', roomRole: 'player' })).toBe('none');
    expect(documentOwnershipLevel(ownership, { userId: 'someone-else', roomRole: 'player' })).toBe('limited');
  });

  it('grants moderators owner capabilities and platform audits read-only access', () => {
    expect(canUpdateDocument(ownership, { userId: 'dm', roomRole: 'dm' })).toBe(true);
    expect(canReadDocument(ownership, { userId: 'platform', roomRole: 'spectator', platformReadOnly: true })).toBe(true);
    expect(canUpdateDocument(ownership, { userId: 'platform', roomRole: 'spectator', platformReadOnly: true })).toBe(false);
  });

  it('keeps limited directory visibility separate from opening and editing', () => {
    const viewer = { userId: 'someone-else', roomRole: 'player' as const };
    expect(canSeeDocument(ownership, viewer)).toBe(true);
    expect(canReadDocument(ownership, viewer)).toBe(false);
    expect(canUpdateDocument(ownership, viewer)).toBe(false);
  });

  it('normalizes untrusted ownership and creates stable document links', () => {
    expect(normalizeDocumentOwnership({ default: 'observer', users: { ok: 'owner', bad: 'admin' } })).toEqual({
      default: 'observer', users: { ok: 'owner' },
    });
    expect(documentUuid('journal', 'j-1', 'p-2')).toBe('Journal.j-1.Page.p-2');
  });
});
