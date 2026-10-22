import { useCallback, useEffect, useState } from 'react';

export type WorkspacePanelMode = 'docked' | 'floating';
export type WorkspacePanelId = 'encounter' | 'library';

export interface FloatingRect { x: number; y: number; w: number; h: number }

export interface WorkspaceLayoutState {
  encounterVisible: boolean;
  libraryVisible: boolean;
  encounterMode: WorkspacePanelMode;
  libraryMode: WorkspacePanelMode;
  encounterWidth: number;
  libraryWidth: number;
  encounterRect: FloatingRect;
  libraryRect: FloatingRect;
  focusedPanel: WorkspacePanelId;
  presentation: boolean;
}

const DEFAULT_LAYOUT: WorkspaceLayoutState = {
  encounterVisible: true,
  libraryVisible: true,
  encounterMode: 'docked',
  libraryMode: 'docked',
  encounterWidth: 224,
  libraryWidth: 336,
  encounterRect: { x: 64, y: 16, w: 280, h: 520 },
  libraryRect: { x: 720, y: 16, w: 360, h: 560 },
  focusedPanel: 'library',
  presentation: false,
};

export function useWorkspaceLayout(roomSlug: string) {
  const storageKey = `dnd.workspace.v1.${roomSlug}`;
  const [layout, setLayout] = useState<WorkspaceLayoutState>(() => readLayout(storageKey));

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(layout)); } catch { /* Private browsing may reject persistence. */ }
  }, [layout, storageKey]);

  const update = useCallback((patch: Partial<WorkspaceLayoutState>) => {
    setLayout(current => normalizeLayout({ ...current, ...patch }));
  }, []);

  const setPanelVisible = useCallback((panel: WorkspacePanelId, visible: boolean) => {
    setLayout(current => ({ ...current, [`${panel}Visible`]: visible } as WorkspaceLayoutState));
  }, []);

  const setPanelMode = useCallback((panel: WorkspacePanelId, mode: WorkspacePanelMode) => {
    setLayout(current => ({ ...current, [`${panel}Mode`]: mode, [`${panel}Visible`]: true, focusedPanel: panel } as WorkspaceLayoutState));
  }, []);

  const setPanelWidth = useCallback((panel: WorkspacePanelId, width: number) => {
    setLayout(current => ({ ...current, [`${panel}Width`]: clamp(width, panel === 'encounter' ? 176 : 280, 560) } as WorkspaceLayoutState));
  }, []);

  const setPanelRect = useCallback((panel: WorkspacePanelId, rect: FloatingRect) => {
    setLayout(current => ({ ...current, [`${panel}Rect`]: normalizeRect(rect), focusedPanel: panel } as WorkspaceLayoutState));
  }, []);

  const focusPanel = useCallback((panel: WorkspacePanelId) => setLayout(current => ({ ...current, focusedPanel: panel })), []);

  const reset = useCallback(() => setLayout(DEFAULT_LAYOUT), []);

  return { layout, update, setPanelVisible, setPanelMode, setPanelWidth, setPanelRect, focusPanel, reset };
}

function readLayout(key: string): WorkspaceLayoutState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return window.matchMedia('(max-width: 640px)').matches ? { ...DEFAULT_LAYOUT, encounterVisible: false, libraryVisible: false } : DEFAULT_LAYOUT;
    return normalizeLayout({ ...DEFAULT_LAYOUT, ...(JSON.parse(raw) as Partial<WorkspaceLayoutState>) });
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function normalizeLayout(layout: WorkspaceLayoutState): WorkspaceLayoutState {
  return {
    ...DEFAULT_LAYOUT,
    ...layout,
    encounterWidth: clamp(Number(layout.encounterWidth), 176, 560),
    libraryWidth: clamp(Number(layout.libraryWidth), 280, 560),
    encounterRect: normalizeRect(layout.encounterRect),
    libraryRect: normalizeRect(layout.libraryRect),
    encounterMode: layout.encounterMode === 'floating' ? 'floating' : 'docked',
    libraryMode: layout.libraryMode === 'floating' ? 'floating' : 'docked',
    focusedPanel: layout.focusedPanel === 'encounter' ? 'encounter' : 'library',
  };
}

function normalizeRect(rect: FloatingRect): FloatingRect {
  return {
    x: clamp(Number(rect?.x), 0, 4_000),
    y: clamp(Number(rect?.y), 0, 4_000),
    w: clamp(Number(rect?.w), 220, 720),
    h: clamp(Number(rect?.h), 260, 900),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : minimum;
}
