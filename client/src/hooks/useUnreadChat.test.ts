import { describe, expect, it } from 'vitest';
import { unreadAfter } from './useUnreadChat';
import type { ChatMessage } from '../types';

const message = (id: string, userId: string) => ({ id, userId, campaignId: 'c', author: userId, kind: 'chat', text: id, visibility: 'public', createdAt: 1 }) as ChatMessage;

describe('unreadAfter', () => {
  const list = [message('a', 'me'), message('b', 'dm'), message('c', 'me'), message('d', 'pc')];
  it('counts only messages from others after the last seen one', () => {
    expect(unreadAfter(list, 'a', 'me')).toBe(2);
    expect(unreadAfter(list, 'd', 'me')).toBe(0);
    expect(unreadAfter(list, null, 'me')).toBe(2);
  });
});
