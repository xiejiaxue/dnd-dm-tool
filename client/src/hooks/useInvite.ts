import { useState } from 'react';
import { api } from '../api';

export function useInvite() {
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);

  const createInvite = async () => {
    if (creatingInvite) return;
    setCreatingInvite(true);
    setInviteMessage(null);
    try {
      const invite = await api.createInvite({ role: 'player' });
      const token = invite.token;
      const rawUrl = invite.inviteUrl || invite.url || (token ? `/#invite=${encodeURIComponent(token)}` : '');
      if (!rawUrl) throw new Error('服务未返回邀请链接');
      const url = new URL(rawUrl, location.origin).toString();
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(url);
        setInviteMessage('玩家邀请链接已复制，可以发给朋友。');
      } catch {
        setInviteMessage(`邀请链接：${url}`);
      }
    } catch (error) {
      setInviteMessage(error instanceof Error ? `创建邀请失败：${error.message}` : '创建邀请失败');
    } finally {
      setCreatingInvite(false);
    }
  };

  return { inviteMessage, setInviteMessage, creatingInvite, createInvite };
}
