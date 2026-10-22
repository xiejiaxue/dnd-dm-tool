import { lazy, type ComponentType } from 'react';
import type { IconName } from '../components/Icon';
import type { ShellPage, ToolPage } from './navigation';

// Each tool is its own chunk: the rail renders immediately and only the page
// being opened is downloaded. Hovering a destination warms its chunk.
const loaders = {
  calculator: () => import('../components/QuickCalculator'),
  characters: () => import('../components/CharacterWorkshop'),
  dice: () => import('../components/DiceRoller'),
  music: () => import('../components/MusicBar'),
  tavern: () => import('../components/TavernGame'),
} satisfies Record<ToolPage, () => Promise<{ default: ComponentType }>>;

export const toolComponents = {
  calculator: lazy(loaders.calculator),
  characters: lazy(loaders.characters),
  dice: lazy(loaders.dice),
  music: lazy(loaders.music),
  tavern: lazy(loaders.tavern),
};

export function prefetchTool(page: ShellPage): void {
  if (page !== 'home') void loaders[page]().catch(() => {});
}

export interface Destination {
  page: ShellPage;
  href: string;
  label: string;
  shortLabel?: string;
  eyebrow: string;
  icon: IconName;
}

export const DESTINATIONS: Destination[] = [
  { page: 'home', href: '/', label: '我的桌团', eyebrow: '01 / CAMPAIGNS', icon: 'grid' },
  { page: 'calculator', href: '/calculator', label: '临时计算器', shortLabel: '计算器', eyebrow: '02 / CALCULATOR', icon: 'calculator' },
  { page: 'characters', href: '/characters', label: '角色卡', eyebrow: '03 / CHARACTER', icon: 'users' },
  { page: 'dice', href: '/dice', label: '掷骰', eyebrow: '04 / DICE', icon: 'dice' },
  { page: 'music', href: '/music', label: '配乐', eyebrow: '05 / MUSIC', icon: 'music' },
  { page: 'tavern', href: '/tavern', label: '酒馆经营', shortLabel: '酒馆', eyebrow: '06 / TROLLSKULL TAVERN', icon: 'tavern' },
];
