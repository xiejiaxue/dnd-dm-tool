import { useMemo, useState } from 'react';
import { DEFAULT_TABLETOP_SETTINGS } from '../../types';
import { useTabletopSettings } from './TabletopSettingsContext';

const ACTION_LABELS: Record<string, string> = {
  'ui.command-palette': '打开命令面板', 'ui.toggle-dice': '显示/隐藏掷骰板', 'ui.toggle-library': '显示/隐藏资料栏',
  'ui.toggle-encounter': '显示/隐藏敌人栏', 'history.undo': '撤销', 'history.redo': '重做', 'encounter.next-turn': '战斗下一行动',
};

export default function SettingsPanel() {
  const { settings, save, reset } = useTabletopSettings();
  const [error, setError] = useState('');
  const conflicts = useMemo(() => {
    const byBinding = new Map<string, string[]>();
    for (const [action, binding] of Object.entries(settings.keybindings)) { const key = binding.toLowerCase(); const entries = byBinding.get(key) ?? []; entries.push(action); byBinding.set(key, entries); }
    return new Set([...byBinding.values()].filter(entries => entries.length > 1).flat());
  }, [settings.keybindings]);
  const update = async (patch: Parameters<typeof save>[0]) => { try { await save(patch); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '设置保存失败'); } };
  return <div className="h-full overflow-y-auto p-3 text-xs"><h3 className="mb-3 font-semibold text-zinc-100">当前用户设置</h3><div className="space-y-2 rounded border border-zinc-800 p-3">
    <Toggle label="紧凑界面" checked={settings.compactMode} onChange={value => void update({ compactMode: value })} /><Toggle label="减少动画" checked={settings.reduceMotion} onChange={value => void update({ reduceMotion: value })} /><Toggle label="破坏性操作再次确认" checked={settings.confirmDestructiveActions} onChange={value => void update({ confirmDestructiveActions: value })} /><Toggle label="显示 HP 浮动变化" checked={settings.showFloatingText} onChange={value => void update({ showFloatingText: value })} />
    <label className="block"><span className="mb-1 block text-zinc-500">界面字号 {Math.round(settings.fontScale * 100)}%</span><input type="range" min={.8} max={1.4} step={.05} value={settings.fontScale} onChange={event => void update({ fontScale: Number(event.target.value) })} className="w-full" /></label>
    <label className="block"><span className="mb-1 block text-zinc-500">默认掷骰可见性</span><select value={settings.defaultRollMode} onChange={event => void update({ defaultRollMode: event.target.value === 'gm' ? 'gm' : 'all' })} className="w-full rounded bg-zinc-800 px-2 py-1"><option value="all">所有人</option><option value="gm">仅主持人</option></select></label>
  </div><h3 className="mb-2 mt-4 font-semibold text-zinc-100">快捷键</h3><div className="space-y-1">{Object.entries(settings.keybindings).map(([action, binding]) => <label key={action} className="grid grid-cols-[1fr_8rem] items-center gap-2 rounded bg-zinc-950/50 px-2 py-1.5"><span className={conflicts.has(action) ? 'text-red-300' : 'text-zinc-300'}>{ACTION_LABELS[action] ?? action}</span><input value={binding} onChange={event => void update({ keybindings: { ...settings.keybindings, [action]: event.target.value } })} className={`rounded bg-zinc-800 px-2 py-1 text-center font-mono text-[11px] ${conflicts.has(action) ? 'ring-1 ring-red-500' : ''}`} /></label>)}</div>{conflicts.size > 0 && <p className="mt-2 text-red-300">存在快捷键冲突，请修改红色项目。</p>}{error && <p className="mt-2 text-red-400">{error}</p>}<button onClick={() => void reset()} className="mt-4 w-full rounded bg-zinc-800 py-2 text-zinc-400">恢复默认设置</button><p className="mt-2 leading-5 text-zinc-600">设置按房间和用户保存；工作区布局继续保存在当前设备。</p></div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) { return <label className="flex items-center justify-between gap-2"><span className="text-zinc-300">{label}</span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /></label>; }

export { ACTION_LABELS };

