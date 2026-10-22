import { useState } from 'react';
import { api } from '../api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function InvitePlayerButton({ open, onOpenChange }: Props) {
  const [invite, setInvite] = useState<{ code: string | null; url: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const copy = async (value: string, success: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setMessage(success);
    } catch {
      setMessage(`请手动复制：${value}`);
    }
  };

  const createInvite = async () => {
    if (creating) return;
    setCreating(true);
    setMessage(null);
    try {
      const result = await api.createInvite({ role: 'player' });
      const rawUrl = result.inviteUrl || result.url || (result.token ? `/#invite=${encodeURIComponent(result.token)}` : '');
      if (!rawUrl) throw new Error('服务未返回邀请链接');
      const url = new URL(rawUrl, location.origin).toString();
      const code = result.inviteCode ?? null;
      setInvite({ code, url });
      if (code) await copy(code, '邀请码已复制，玩家可随时填码加入。');
      else await copy(url, '邀请链接已复制，可以发给朋友。');
    } catch (error) {
      setMessage(error instanceof Error ? `创建邀请失败：${error.message}` : '创建邀请失败');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <button
        onClick={() => { onOpenChange(true); void createInvite(); }}
        disabled={creating}
        className="px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 disabled:opacity-50 whitespace-nowrap"
        title="获取长期有效、可重复使用的玩家邀请码"
      >{creating ? '读取中…' : '邀请玩家'}</button>
      {open && (invite || message) && (
        <div className="absolute top-12 right-3 z-30 w-80 max-w-[calc(100vw-1.5rem)] rounded border border-zinc-700 bg-zinc-800 px-3 py-3 text-xs shadow-xl text-zinc-200">
          <button onClick={() => { onOpenChange(false); setInvite(null); setMessage(null); }} className="float-right ml-3 text-zinc-500 hover:text-white" aria-label="关闭邀请提示" title="关闭邀请提示">✕</button>
          {invite?.code && (
            <>
              <p className="pr-5 font-medium text-emerald-300">长期邀请码</p>
              <p className="mt-1 text-zinc-400">玩家可随时在大厅输入此码加入，不限使用次数。</p>
              <code className="mt-2 block select-all rounded bg-zinc-950 px-2 py-1.5 text-center font-mono text-sm tracking-widest text-amber-300">{invite.code}</code>
              <div className="mt-2 flex gap-2">
                <button onClick={() => { void copy(invite.code!, '邀请码已复制。'); }} className="rounded bg-emerald-600/20 px-2 py-1 hover:bg-emerald-600/30">复制邀请码</button>
                <button onClick={() => { void copy(invite.url, '邀请链接已复制。'); }} className="rounded bg-zinc-700 px-2 py-1 hover:bg-zinc-600">复制链接</button>
              </div>
            </>
          )}
          {message && <p className="mt-2 pr-4 text-zinc-300">{message}</p>}
        </div>
      )}
    </>
  );
}
