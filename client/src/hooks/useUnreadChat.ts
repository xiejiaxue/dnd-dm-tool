import { useEffect, useState } from 'react';
import type { ChatMessage } from '../types';

/**
 * Count messages from others that arrived since chat was last on screen.
 * History already present when the table first loads counts as read.
 */
export function useUnreadChat(messages: readonly ChatMessage[], myUserId: string | undefined, viewing: boolean, loaded: boolean): number {
  const lastId = messages.at(-1)?.id ?? null;
  // undefined until the first room snapshot arrives; null for an empty history.
  const [seenId, setSeenId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (viewing || (loaded && seenId === undefined)) setSeenId(lastId);
  }, [viewing, loaded, lastId, seenId]);
  if (viewing || seenId === undefined) return 0;
  return unreadAfter(messages, seenId, myUserId);
}

export function unreadAfter(messages: readonly ChatMessage[], seenId: string | null, myUserId: string | undefined): number {
  const index = seenId === null ? -1 : messages.findIndex(message => message.id === seenId);
  return messages.slice(index + 1).filter(message => message.userId !== myUserId).length;
}
