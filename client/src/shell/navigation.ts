import { useSyncExternalStore } from 'react';

/** Pages that share the Swiss navigation rail and switch without a reload. */
export const SHELL_PAGES = {
  '/': 'home',
  '/calculator': 'calculator',
  '/characters': 'characters',
  '/dice': 'dice',
  '/music': 'music',
  '/tavern': 'tavern',
  '/calendar': 'tavern',
} as const;

export type ShellPage = (typeof SHELL_PAGES)[keyof typeof SHELL_PAGES];
export type ToolPage = Exclude<ShellPage, 'home'>;

export function shellPageFor(pathname: string): ShellPage | null {
  return (SHELL_PAGES as Record<string, ShellPage>)[pathname] ?? null;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

/** History navigation that also informs every `usePathname` subscriber. */
export function navigate(to: string, replace = false): void {
  if (`${location.pathname}${location.search}` === to) return;
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    removeEventListener('popstate', listener);
  };
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}
