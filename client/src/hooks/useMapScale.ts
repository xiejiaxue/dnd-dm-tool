import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { connection } from '../ws';
import { clampZoom } from '../components/board-zoom';

type Context = { sceneId?: string; mapImage?: string | null; value: number; enabled: boolean };
type Draft = { sceneId?: string; mapImage?: string | null; value: number };

/** Preview at display cadence; publish one existing updateMapScale op on release. */
export function useMapScale(context: Context) {
  const current = useRef(context);
  current.current = context;
  const draft = useRef<Draft | null>(null);
  const frame = useRef<number | null>(null);
  const [local, setLocal] = useState<Draft | null>(null);
  const cancel = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    draft.current = null;
    setLocal(null);
  }, []);

  useLayoutEffect(() => {
    cancel();
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      draft.current = null;
    };
  }, [context.sceneId, context.mapImage, context.enabled, cancel]);

  const preview = useCallback((value: number) => {
    const scope = current.current;
    if (!scope.enabled || !scope.sceneId || !scope.mapImage) return;
    draft.current = { sceneId: scope.sceneId, mapImage: scope.mapImage, value: clampZoom(value) };
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => { frame.current = null; setLocal(draft.current); });
  }, []);

  const commit = useCallback(() => {
    const pending = draft.current, scope = current.current;
    if (pending && scope.enabled && pending.sceneId === scope.sceneId && pending.mapImage === scope.mapImage && pending.value !== scope.value) {
      connection.sendOps([{ op: 'updateMapScale', mapScale: pending.value }]);
    }
    // The connection's existing optimistic state handles acknowledgement/rollback.
    cancel();
  }, [cancel]);

  const set = useCallback((value: number) => { preview(value); commit(); }, [preview, commit]);
  const value = local && local.sceneId === context.sceneId && local.mapImage === context.mapImage ? local.value : context.value;
  return { value, preview, commit, cancel, set };
}
