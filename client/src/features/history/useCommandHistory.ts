import { useCallback, useEffect, useState } from 'react';

export interface HistoryEntry {
  label: string;
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
}

export function useCommandHistory(limit = 50) {
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const record = useCallback((entry: HistoryEntry) => {
    setUndoStack(current => [...current, entry].slice(-limit));
    setRedoStack([]);
    setNotice(entry.label);
  }, [limit]);

  const clear = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
    setNotice('');
  }, []);

  const undo = useCallback(async () => {
    if (busy) return;
    const entry = undoStack.at(-1);
    if (!entry) return;
    setBusy(true);
    try {
      await entry.undo();
      setUndoStack(current => current.slice(0, -1));
      setRedoStack(current => [...current, entry].slice(-limit));
      setNotice(`已撤销：${entry.label}`);
    } catch {
      setNotice(`撤销失败：${entry.label}`);
    } finally {
      setBusy(false);
    }
  }, [busy, limit, undoStack]);

  const redo = useCallback(async () => {
    if (busy) return;
    const entry = redoStack.at(-1);
    if (!entry) return;
    setBusy(true);
    try {
      await entry.redo();
      setRedoStack(current => current.slice(0, -1));
      setUndoStack(current => [...current, entry].slice(-limit));
      setNotice(`已重做：${entry.label}`);
    } catch {
      setNotice(`重做失败：${entry.label}`);
    } finally {
      setBusy(false);
    }
  }, [busy, limit, redoStack]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      event.preventDefault();
      if (event.shiftKey) void redo();
      else void undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [redo, undo]);

  return {
    record,
    clear,
    undo,
    redo,
    busy,
    notice,
    canUndo: !busy && undoStack.length > 0,
    canRedo: !busy && redoStack.length > 0,
    undoLabel: undoStack.at(-1)?.label ?? '',
    redoLabel: redoStack.at(-1)?.label ?? '',
  };
}
