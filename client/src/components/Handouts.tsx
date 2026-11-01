import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { connection, useScene } from '../ws';
import { uploadImage } from '../upload';
import { shownHandout } from '../../../shared/table-state';
import type { Handout } from '../types';
import CampaignIcon from './CampaignIcon';
import ConfirmButton from './ConfirmButton';

function handoutId() {
  return `handout-${crypto.randomUUID()}`;
}

/** The image the DM is showing, full size over the table. Closing it only closes it here. */
export function HandoutViewer({ handout, onClose, onHide }: { handout: Handout; onClose: () => void; onHide?: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="handout-viewer" role="dialog" aria-modal="true" aria-label={`展示：${handout.title}`} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <figure>
      <img src={handout.image} alt={handout.title} />
      <figcaption>
        <strong>{handout.title}</strong>
        {onHide && <button type="button" className="btn-xs" onClick={onHide} title="所有玩家的画面一起收起">为所有人收起</button>}
        <button type="button" className="btn-primary" onClick={onClose}>关闭</button>
      </figcaption>
    </figure>
  </div>;
}

/**
 * Header control for handouts. The DM uploads or reuses an image and shows it
 * to the table; players get it on screen automatically and can reopen it.
 */
export default function Handouts({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { role, campaign } = useScene();
  const shown = shownHandout(campaign);
  const [viewing, setViewing] = useState<Handout | null>(null);
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const seen = useRef<string | null>(null);
  const isDm = role === 'dm';

  // Each newly shown image pops up once for players; closing it keeps it closed until the next one.
  useEffect(() => {
    if (isDm || !shown || seen.current === shown.id) { if (!shown) setViewing(null); return; }
    seen.current = shown.id;
    setViewing(shown);
  }, [isDm, shown?.id]);

  const onPicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true); setError('');
    try {
      const image = await uploadImage(file, 'map');
      connection.sendOps([{ op: 'showHandout', handout: { id: handoutId(), title: title.trim() || file.name.replace(/\.[^.]+$/, '').slice(0, 120) || '展示', image } }]);
      setTitle('');
    } catch (cause) {
      setError(cause instanceof Error ? `上传失败：${cause.message}` : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  if (!isDm) {
    return <>
      {shown && <button className="btn-quiet" onClick={() => setViewing(shown)} title="查看 DM 正在展示的图片"><CampaignIcon name="image" /><span>展示</span></button>}
      {viewing && <HandoutViewer handout={viewing} onClose={() => setViewing(null)} />}
    </>;
  }

  const history = campaign?.handouts ?? [];
  return <>
    <button className={`btn-quiet ${shown ? 'text-accent' : ''}`} aria-expanded={open} onClick={() => onOpenChange(!open)} title={shown ? `正在展示：${shown.title}` : '给玩家展示图片'}><CampaignIcon name="image" /><span>展示</span></button>
    {open && <div className="campaign-handout-popover" role="dialog" aria-label="展示给玩家">
      <div>
        <div className="flex items-center justify-between"><span className="panel-label">展示给玩家</span><button aria-label="关闭" onClick={() => onOpenChange(false)}><CampaignIcon name="close" /></button></div>
        {shown && <div className="handout-current"><span>正在展示：<strong>{shown.title}</strong></span><button className="btn-xs" onClick={() => connection.sendOps([{ op: 'hideHandout' }])}>收起</button></div>}
        <div className="handout-upload">
          <input className="field-sm" placeholder="标题（可选）" aria-label="展示标题" maxLength={120} value={title} onChange={event => setTitle(event.target.value)} />
          <button className="btn-accent" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? '上传中…' : '上传并展示'}</button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif" className="hidden" onChange={event => { void onPicked(event); }} />
        </div>
        {error && <p role="alert" className="text-xs text-accent">{error}</p>}
        {history.length > 0 && <ul className="handout-history" aria-label="展示过的图片">
          {history.map(handout => <li key={handout.id} className={handout.id === shown?.id ? 'is-shown' : ''}>
            <button className="handout-thumb" onClick={() => setViewing(handout)} title="预览，只有你看得到"><img src={handout.image} alt="" /></button>
            <span className="truncate">{handout.title}</span>
            <button className="btn-xs" disabled={handout.id === shown?.id} onClick={() => connection.sendOps([{ op: 'showHandout', handout }])}>展示</button>
            <ConfirmButton className="btn-xs" armedClassName="text-accent" confirmLabel="确认删除" title="从展示记录中删除" onConfirm={() => connection.sendOps([{ op: 'removeHandout', handoutId: handout.id }])}>删除</ConfirmButton>
          </li>)}
        </ul>}
        {!history.length && <p className="text-xs text-muted">上传的图片会立刻出现在所有玩家的屏幕上，之后可以在这里再次展示。</p>}
      </div>
    </div>}
    {viewing && <HandoutViewer handout={viewing} onClose={() => setViewing(null)} onHide={viewing.id === shown?.id ? () => { connection.sendOps([{ op: 'hideHandout' }]); setViewing(null); } : undefined} />}
  </>;
}
