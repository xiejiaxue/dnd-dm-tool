import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { DEFAULT_TABLETOP_SETTINGS, type TabletopSettings } from '../../types';

interface SettingsApi {
  settings: TabletopSettings;
  loading: boolean;
  save(patch: Partial<TabletopSettings>): Promise<void>;
  reset(): Promise<void>;
  confirmAction(message: string): boolean;
}

const Context = createContext<SettingsApi | null>(null);

export function TabletopSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<TabletopSettings>(DEFAULT_TABLETOP_SETTINGS);
  const settingsRef = useRef<TabletopSettings>(DEFAULT_TABLETOP_SETTINGS);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const saveRevision = useRef(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let cancelled = false; api.tabletopSettings().then(value => { if (!cancelled) { settingsRef.current = value; setSettings(value); } }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--tabletop-font-scale', String(settings.fontScale));
    root.classList.toggle('tabletop-compact', settings.compactMode);
    root.classList.toggle('tabletop-reduce-motion', settings.reduceMotion);
    return () => { root.style.removeProperty('--tabletop-font-scale'); root.classList.remove('tabletop-compact', 'tabletop-reduce-motion'); };
  }, [settings]);
  const save = useCallback(async (patch: Partial<TabletopSettings>) => {
    const previous = settingsRef.current;
    const optimistic = { ...previous, ...patch };
    const revision = ++saveRevision.current;
    settingsRef.current = optimistic;
    setSettings(optimistic);
    const request = saveQueue.current.then(() => api.updateTabletopSettings(patch));
    saveQueue.current = request.catch(() => undefined);
    try {
      const persisted = await request;
      if (revision === saveRevision.current) { settingsRef.current = persisted; setSettings(persisted); }
    } catch (error) {
      if (revision === saveRevision.current) { settingsRef.current = previous; setSettings(previous); }
      throw error;
    }
  }, []);
  const reset = useCallback(async () => { await save(DEFAULT_TABLETOP_SETTINGS); }, [save]);
  const confirmAction = useCallback((message: string) => !settings.confirmDestructiveActions || window.confirm(message), [settings.confirmDestructiveActions]);
  const value = useMemo(() => ({ settings, loading, save, reset, confirmAction }), [settings, loading, save, reset, confirmAction]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useTabletopSettings(): SettingsApi {
  const value = useContext(Context);
  if (!value) throw new Error('Tabletop settings require provider');
  return value;
}

export function eventMatchesBinding(event: KeyboardEvent, binding: string, platform = navigator.platform): boolean {
  const parts = binding.split('+').map(part => part.trim().toLowerCase()).filter(Boolean);
  const key = parts.at(-1);
  if (!key) return false;
  const mac = platform.toLowerCase().includes('mac');
  const mod = parts.includes('mod');
  const wantsCtrl = parts.includes('ctrl') || (mod && !mac);
  const wantsMeta = parts.includes('meta') || (mod && mac);
  if (wantsCtrl !== event.ctrlKey || wantsMeta !== event.metaKey || parts.includes('alt') !== event.altKey || parts.includes('shift') !== event.shiftKey) return false;
  return event.key.toLowerCase() === key.toLowerCase();
}
