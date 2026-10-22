import { useLayoutEffect, useState } from 'react';
import CampaignIcon from './CampaignIcon';
import { clampZoom, MAX_ZOOM, MIN_ZOOM } from './board-zoom';

interface Props {
  kind: 'map' | 'view';
  value: number;
  onChange: (value: number) => void;
  onStep: (value: number) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  onReset: () => void;
}

export default function ZoomControl({ kind, value, onChange, onStep, onCommit, onCancel, onReset }: Props) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(() => Math.round(value * 100));
  useLayoutEffect(() => { if (!editing) setInputValue(Math.round(value * 100)); }, [value, editing]);
  const finish = () => { setEditing(false); onCommit?.(); };
  const title = kind === 'map' ? '地图图片' : '战斗视图';
  const label = kind === 'map' ? '地图图片缩放' : '战斗区整体缩放';
  return <div className="campaign-zoom-control" role="group" aria-label={title}>
    <div className="campaign-zoom-caption"><span><CampaignIcon name={kind === 'map' ? 'map' : 'view'} />{title}<small>{kind === 'map' ? '仅底图' : '整体'}</small></span><output aria-label={`${title}当前比例`}>{Math.round(value * 100)}%</output></div>
    <div className="campaign-zoom-inputs">
      <button type="button" aria-label={`${title}缩小`} disabled={value <= MIN_ZOOM} onClick={() => onStep(clampZoom(value - 0.01))}><CampaignIcon name="minus" /></button>
      <input type="range" min={MIN_ZOOM * 100} max={MAX_ZOOM * 100} step="1" value={inputValue} aria-label={label} aria-valuetext={`${Math.round(value * 100)}%`} onChange={event => { const next = Number(event.currentTarget.value); setEditing(true); setInputValue(next); onChange(next / 100); }} onPointerDown={event => { setEditing(true); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={finish} onPointerCancel={() => { setEditing(false); onCancel?.(); }} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) finish(); }} onBlur={finish} />
      <button type="button" aria-label={`${title}放大`} disabled={value >= MAX_ZOOM} onClick={() => onStep(clampZoom(value + 0.01))}><CampaignIcon name="plus" /></button>
      <button type="button" aria-label={`${title}复位`} title={kind === 'map' ? '底图恢复 100%' : '视图恢复 100% 并返回原点'} onClick={onReset}><CampaignIcon name="reset" /></button>
    </div>
  </div>;
}
