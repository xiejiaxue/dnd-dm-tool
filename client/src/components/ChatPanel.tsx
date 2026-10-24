import { useEffect, useRef, useState, type FormEvent } from 'react';
import { connection, useScene } from '../ws';
import { chatRollExpression, parseRollNotation } from '../../../shared/dice-notation';

const ROLL_HINT = '骰子公式无效，例如 /r d20、/r 2d6+3、/r 2d20kh1（优势）';

export default function ChatPanel() {
  const { messages, connected } = useScene();
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'gm' | 'self'>('public');
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  const send = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    const expression = chatRollExpression(value);
    if (expression !== null && !parseRollNotation(expression)) { setError(ROLL_HINT); return; }
    setError('');
    // Chat is not queued while reconnecting; keep the draft until it is sent.
    if (connection.sendControl({ type: 'chat', id: crypto.randomUUID(), text: value, visibility })) setText('');
  };

  const roll = (expression: string) => {
    connection.sendControl({ type: 'chat', id: crypto.randomUUID(), text: `/r ${expression}`, visibility });
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
                <span className="text-xs text-muted tabular-nums">{message.formula}：[{message.rolls?.map((value, index) => (
                  <span key={index}>{index > 0 && ', '}<span className={message.dropped?.includes(index) ? 'line-through opacity-50' : undefined}>{value}</span></span>
                ))}]</span>
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
            <button key={faces} disabled={!connected} onClick={() => roll(`1d${faces}`)} className="btn-xs tabular-nums hover:border-ink hover:text-ink">d{faces}</button>
          ))}
        </div>
        <div className="mb-2 grid grid-cols-2 gap-1">
          <button disabled={!connected} onClick={() => roll('2d20kh1')} title="掷两个 d20 取高" className="btn-xs hover:border-ink hover:text-ink">优势 d20</button>
          <button disabled={!connected} onClick={() => roll('2d20kl1')} title="掷两个 d20 取低" className="btn-xs hover:border-ink hover:text-ink">劣势 d20</button>
        </div>
        <form onSubmit={send} className="flex gap-1.5">
          <select value={visibility} onChange={event => setVisibility(event.target.value as typeof visibility)} className="field-sm w-auto">
            <option value="public">公开</option><option value="gm">给 DM</option><option value="self">自己</option>
          </select>
          <input value={text} onChange={event => { setText(event.target.value); setError(''); }} placeholder="消息或 /r 1d8+1d6+3" aria-invalid={Boolean(error)}
            className="field-sm min-w-0 flex-1" />
          <button className="btn-primary" disabled={!connected} title={connected ? undefined : '正在重新连接'}>发送</button>
        </form>
        {error && <p role="alert" className="mt-1 text-xs text-accent">{error}</p>}
      </div>
    </div>
  );
}
