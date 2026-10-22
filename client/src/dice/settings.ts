import type { TrayShape, TraySize } from './tray';

/** Look and feel of the 3D tray, remembered per browser. */
export type TrayView = 'top' | 'angled' | 'low' | 'free';
export type TrayTheme = 'tavern' | 'dungeon' | 'map' | 'lair' | 'swiss';
export type DiceStyle = 'crimson' | 'obsidian' | 'bone' | 'emerald' | 'arcane';
export type RailHeight = 'low' | 'high';
export interface TraySettings {
  view: TrayView;
  theme: TrayTheme;
  dice: DiceStyle;
  size: TraySize;
  shape: TrayShape;
  rail: RailHeight;
  showColliders: boolean;
}
export const DEFAULT_TRAY_SETTINGS: TraySettings = {
  view: 'angled', theme: 'tavern', dice: 'crimson', size: 'medium', shape: 'octagon', rail: 'high', showColliders: false,
};

type Options<T extends string> = readonly { value: T; label: string }[];
export const VIEW_OPTIONS: Options<TrayView> = [
  { value: 'top', label: '俯视' }, { value: 'angled', label: '斜视' }, { value: 'low', label: '低角' }, { value: 'free', label: '自由' },
];
export const THEME_OPTIONS: Options<TrayTheme> = [
  { value: 'tavern', label: '酒馆绒布' }, { value: 'dungeon', label: '地城石板' }, { value: 'map', label: '冒险地图' },
  { value: 'lair', label: '龙穴' }, { value: 'swiss', label: '简洁' },
];
export const DICE_OPTIONS: Options<DiceStyle> = [
  { value: 'crimson', label: '赤红' }, { value: 'obsidian', label: '黑曜金' }, { value: 'bone', label: '骨白' },
  { value: 'emerald', label: '翡翠' }, { value: 'arcane', label: '奥术紫' },
];
export const SIZE_OPTIONS: Options<TraySize> = [{ value: 'small', label: '小' }, { value: 'medium', label: '中' }, { value: 'large', label: '大' }];
export const SHAPE_OPTIONS: Options<TrayShape> = [{ value: 'octagon', label: '八角' }, { value: 'square', label: '方形' }];
export const RAIL_OPTIONS: Options<RailHeight> = [{ value: 'low', label: '矮栏' }, { value: 'high', label: '高栏' }];

const pick = <T extends string>(options: Options<T>, value: unknown, fallback: T): T =>
  options.some(option => option.value === value) ? value as T : fallback;

/** Accepts anything read back from storage and keeps only recognised values. */
export function parseTraySettings(raw: unknown): TraySettings {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const d = DEFAULT_TRAY_SETTINGS;
  return {
    view: pick(VIEW_OPTIONS, value.view, d.view),
    theme: pick(THEME_OPTIONS, value.theme, d.theme),
    dice: pick(DICE_OPTIONS, value.dice, d.dice),
    size: pick(SIZE_OPTIONS, value.size, d.size),
    shape: pick(SHAPE_OPTIONS, value.shape, d.shape),
    rail: pick(RAIL_OPTIONS, value.rail, d.rail),
    showColliders: typeof value.showColliders === 'boolean' ? value.showColliders : d.showColliders,
  };
}
