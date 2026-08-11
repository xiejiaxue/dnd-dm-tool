import { useEffect, useRef, useState, type FormEvent } from 'react';
import { connection, useScene } from '../ws';

export default function ChatPanel() {
  const { messages } = useScene();
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'gm' | 'self'>('public');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [messages.length]);

  const send = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    connection.sendControl({ type: 'chat', id: crypto.randomUUID(), text: value, visibility });
    setText('');
  };

  const roll = (faces: number) => {
    connection.sendControl({ type: 'chat', id: crypto.randomUUID(), text: `/r 1d${faces}`, visibility });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-2">
        {messages.length === 0 && <p className="p-3 text-center text-xs text-zinc-600">聊天与骰子结果会随战役存档保存</p>}
        {messages.map(message => (
          <div key={message.id} className={`mb-2 rounded-lg border p-2 ${message.kind === 'roll' ? 'border-amber-500/30 bg-amber-500/10' : 'border-zinc-800 bg-zinc-950/40'}`}>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="font-medium text-zinc-300">{message.author}</span>
              <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              {message.visibility !== 'public' && <span className="ml-auto text-violet-400">{message.visibility === 'gm' ? '私密给 DM' : '仅自己'}</span>}
            </div>
            {message.kind === 'roll' ? (
              <div className="mt-1">
                <span className="text-xs text-amber-300">{message.formula}：[{message.rolls?.join(', ')}]</span>
                <strong className="float-right text-lg text-amber-300">{message.total}</strong>
              </div>
            ) : <p className="mt-1 whitespace-pre-wrap break-words text-zinc-200">{message.text}</p>}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="border-t border-zinc-800 p-2">
        <div className="mb-2 grid grid-cols-7 gap-1">
          {[4, 6, 8, 10, 12, 20, 100].map(faces => (
            <button key={faces} onClick={() => roll(faces)} className="rounded bg-zinc-800 py-1 text-xs text-amber-300 hover:bg-zinc-700">d{faces}</button>
          ))}
        </div>
        <form onSubmit={send} className="flex gap-1">
          <select value={visibility} onChange={event => setVisibility(event.target.value as typeof visibility)} className="w-20 rounded bg-zinc-800 px-1 text-xs">
            <option value="public">公开</option><option value="gm">给 DM</option><option value="self">自己</option>
          </select>
          <input value={text} onChange={event => setText(event.target.value)} placeholder="消息或 /r 2d20+5"
            className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 outline-none focus:ring-1 focus:ring-amber-500" />
          <button className="rounded bg-amber-500 px-2 text-zinc-950 hover:bg-amber-400">发送</button>
        </form>
      </div>
    </div>
  );
}
