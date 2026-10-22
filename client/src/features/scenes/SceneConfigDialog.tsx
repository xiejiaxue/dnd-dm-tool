import { useEffect, useState, type ReactNode } from 'react';
import type { Scene, SceneConfigurationPatch } from '../../types';

interface Props {
  scene: Scene;
  busy?: boolean;
  error?: string;
  onClose(): void;
  onSave(patch: SceneConfigurationPatch): void;
}

export default function SceneConfigDialog({ scene, busy = false, error = '', onClose, onSave }: Props) {
  const [name, setName] = useState(scene.name);
  const [unlocked, setUnlocked] = useState(Boolean(scene.unlocked));
  const [mapScale, setMapScale] = useState(String(scene.mapScale ?? 1));
  const [gridSize, setGridSize] = useState(String(scene.grid.size));
  const [gridColor, setGridColor] = useState(scene.grid.color);
  const [offsetX, setOffsetX] = useState(String(scene.grid.offset[0]));
  const [offsetY, setOffsetY] = useState(String(scene.grid.offset[1]));
  const [snap, setSnap] = useState(scene.grid.snap);
  const [areaX, setAreaX] = useState(String(scene.playArea.x));
  const [areaY, setAreaY] = useState(String(scene.playArea.y));
  const [areaW, setAreaW] = useState(String(scene.playArea.w));
  const [areaH, setAreaH] = useState(String(scene.playArea.h));
  const [viewX, setViewX] = useState(String(scene.initialView?.x ?? 0));
  const [viewY, setViewY] = useState(String(scene.initialView?.y ?? 0));
  const [viewScale, setViewScale] = useState(String(scene.initialView?.scale ?? 1));
  const [validation, setValidation] = useState('');

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  const save = () => {
    const values = [mapScale, gridSize, offsetX, offsetY, areaX, areaY, areaW, areaH, viewX, viewY, viewScale].map(Number);
    if (!name.trim() || values.some(value => !Number.isFinite(value))) {
      setValidation('请填写有效的场景名称和数字设置');
      return;
    }
    const [nextMapScale, nextGridSize, nextOffsetX, nextOffsetY, nextAreaX, nextAreaY, nextAreaW, nextAreaH, nextViewX, nextViewY, nextViewScale] = values;
    if (nextMapScale < 0.1 || nextMapScale > 8 || nextGridSize < 10 || nextGridSize > 500
      || nextAreaW < 1 || nextAreaH < 1 || nextViewScale < 0.1 || nextViewScale > 8) {
      setValidation('地图比例需为 10%–800%，网格为 10–500，游戏区域必须大于 0');
      return;
    }
    setValidation('');
    onSave({
      name: name.trim(),
      unlocked,
      mapScale: nextMapScale,
      grid: { size: nextGridSize, color: gridColor, offset: [nextOffsetX, nextOffsetY], snap },
      playArea: { x: nextAreaX, y: nextAreaY, w: nextAreaW, h: nextAreaH },
      initialView: { x: nextViewX, y: nextViewY, scale: nextViewScale },
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={`配置场景 ${scene.name}`}>
      <section className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold text-zinc-100">场景配置</h2>
            <p className="truncate text-[11px] text-zinc-500">{scene.mapImage ? `${scene.mapSize[0]} × ${scene.mapSize[1]} 地图` : '空白场景'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭场景配置" title="关闭场景配置" className="rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-white">×</button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 text-sm">
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 font-medium text-zinc-200">基础</legend>
            <Field label="场景名称" wide><input value={name} onChange={event => setName(event.target.value)} className={inputClass} /></Field>
            <label className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-zinc-300">
              <input type="checkbox" checked={unlocked} onChange={event => setUnlocked(event.target.checked)} />允许玩家自行查看
            </label>
            <Field label="地图显示比例"><NumberInput value={mapScale} onChange={setMapScale} step="0.05" /></Field>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 font-medium text-zinc-200">网格</legend>
            <Field label="网格尺寸"><NumberInput value={gridSize} onChange={setGridSize} /></Field>
            <Field label="网格颜色"><input value={gridColor} onChange={event => setGridColor(event.target.value)} className={inputClass} /></Field>
            <Field label="横向偏移"><NumberInput value={offsetX} onChange={setOffsetX} /></Field>
            <Field label="纵向偏移"><NumberInput value={offsetY} onChange={setOffsetY} /></Field>
            <label className="flex items-center gap-2 text-zinc-300"><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)} />Token 吸附网格</label>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-4">
            <legend className="mb-2 font-medium text-zinc-200">游戏区域</legend>
            <Field label="X"><NumberInput value={areaX} onChange={setAreaX} /></Field>
            <Field label="Y"><NumberInput value={areaY} onChange={setAreaY} /></Field>
            <Field label="宽"><NumberInput value={areaW} onChange={setAreaW} /></Field>
            <Field label="高"><NumberInput value={areaH} onChange={setAreaH} /></Field>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 font-medium text-zinc-200">重置视图目标</legend>
            <Field label="画布 X"><NumberInput value={viewX} onChange={setViewX} /></Field>
            <Field label="画布 Y"><NumberInput value={viewY} onChange={setViewY} /></Field>
            <Field label="缩放"><NumberInput value={viewScale} onChange={setViewScale} step="0.05" /></Field>
          </fieldset>
        </div>

        {(validation || error) && <p className="border-t border-red-900/50 bg-red-950/20 px-4 py-2 text-xs text-red-300">{validation || error}</p>}
        <footer className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button type="button" onClick={onClose} className="rounded bg-zinc-800 px-4 py-2 text-zinc-300 hover:bg-zinc-700">取消</button>
          <button type="button" onClick={save} disabled={busy} className="rounded bg-amber-500/20 px-4 py-2 text-amber-300 hover:bg-amber-500/30 disabled:opacity-40">{busy ? '保存中…' : '保存配置'}</button>
        </footer>
      </section>
    </div>
  );
}

const inputClass = 'w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-200 outline-none focus:border-amber-500';

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={`space-y-1 text-xs text-zinc-500 ${wide ? 'sm:col-span-2' : ''}`}><span>{label}</span>{children}</label>;
}

function NumberInput({ value, onChange, step = '1' }: { value: string; onChange(value: string): void; step?: string }) {
  return <input type="number" value={value} step={step} onChange={event => onChange(event.target.value)} className={inputClass} />;
}
