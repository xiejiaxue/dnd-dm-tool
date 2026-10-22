import Konva from 'konva';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { zoomViewport, type BoardViewport } from './geometry';
import type { SceneInitialView } from '../../types';

/** Pan/zoom state isolated from board tools and room mutations. */
export function useBoardView(stageRef: RefObject<Konva.Stage>, sceneId?: string, initialView?: SceneInitialView) {
  const initial = (): BoardViewport => ({
    scale: initialView?.scale ?? 1,
    pos: { x: initialView?.x ?? 0, y: initialView?.y ?? 0 },
  });
  const [viewport, setViewport] = useState<BoardViewport>(initial);
  const pendingViewport = useRef<BoardViewport | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  useEffect(() => {
    pendingViewport.current = null;
    setViewport(initial());
    // A scene switch is the reset boundary. Configuration changes should not
    // unexpectedly move a moderator who is currently inspecting the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  const schedule = useCallback((next: BoardViewport) => {
    pendingViewport.current = next;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      const pending = pendingViewport.current;
      pendingViewport.current = null;
      frame.current = null;
      if (pending) setViewport(pending);
    });
  }, []);

  const zoomAt = useCallback((pointer: { x: number; y: number }, factor: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const current = pendingViewport.current ?? {
      scale: stage.scaleX(),
      pos: { x: stage.x(), y: stage.y() },
    };
    schedule(zoomViewport(current, pointer, factor));
  }, [schedule, stageRef]);

  const zoomCenter = useCallback((factor: number) => {
    const stage = stageRef.current;
    if (stage) zoomAt({ x: stage.width() / 2, y: stage.height() / 2 }, factor);
  }, [stageRef, zoomAt]);

  const resetView = useCallback(() => schedule(initial()), [schedule, initialView?.x, initialView?.y, initialView?.scale]);

  const handleWheel = useCallback((event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    zoomAt(pointer, event.evt.deltaY > 0 ? 0.9 : 1.1);
  }, [stageRef, zoomAt]);

  const setPosition = useCallback((pos: { x: number; y: number }) => {
    pendingViewport.current = null;
    setViewport(current => ({ ...current, pos }));
  }, []);

  return {
    scale: viewport.scale,
    pos: viewport.pos,
    setPosition,
    zoomAt,
    zoomCenter,
    resetView,
    handleWheel,
  };
}
