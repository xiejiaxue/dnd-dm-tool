import { useEffect, useRef, useState, type FormEvent } from 'react';
import { connection, useScene } from '../ws';

export default function ChatPanel() {
  const { messages } = useScene();
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'gm' | 'self'>('public');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

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
        {messages.length === 0 && <p className="p-3 text-center text-xs text-faint">聊天与骰子结果会随战役存档保存</p>}
        {messages.map(message => (
          <div key={message.id} className={`mb-2 border p-2 ${message.kind === 'roll' ? 'border-line border-l-2 border-l-accent bg-well' : 'border-line bg-paper'}`}>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="font-medium text-ink">{message.author}</span>
              <span className="tabular-nums">{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              {message.visibility !== 'public' && <span className="ml-auto text-accent">{message.visibility === 'gm' ? '私密给 DM' : '仅自己'}</span>}
            </div>
            {message.kind === 'roll' ? (
              <div className="mt-1">
                <span className="text-xs text-muted tabular-nums">{message.formula}：[{message.rolls?.join(', ')}]</span>
                <strong className="float-right text-lg leading-none text-accent tabular-nums">{message.total}</strong>
              </div>
            ) : <p className="mt-1 whitespace-pre-wrap break-words text-ink">{message.text}</p>}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="border-t border-line p-2">
        <div className="mb-2 grid grid-cols-7 gap-1">
          {[4, 6, 8, 10, 12, 20, 100].map(faces => (
            <button key={faces} onClick={() => roll(faces)} className="btn-xs tabular-nums hover:border-ink hover:text-ink">d{faces}</button>
          ))}
        </div>
        <form onSubmit={send} className="flex gap-1.5">
          <select value={visibility} onChange={event => setVisibility(event.target.value as typeof visibility)} className="field-sm w-auto">
            <option value="public">公开</option><option value="gm">给 DM</option><option value="self">自己</option>
          </select>
          <input value={text} onChange={event => setText(event.target.value)} placeholder="消息或 /r 2d20+5"
            className="field-sm min-w-0 flex-1" />
          <button className="btn-primary">发送</button>
        </form>
      </div>
    </div>
  );
}
