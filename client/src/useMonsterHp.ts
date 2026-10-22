import { useEffect } from 'react';
import { connection, type SceneState } from './ws';
import { fillMissingMonsterHp } from './monster-hp';

export function useMonsterHp({ scene, role, connected }: Pick<SceneState, 'scene' | 'role' | 'connected'>) {
  useEffect(() => {
    if (!scene || role !== 'dm' || !connected) return;
    let cancelled = false;
    const room = connection.roomSlug;
    const fill = () => fillMissingMonsterHp(scene, () => {
      const state = connection.lastState;
      return !cancelled && connection.connected && connection.roomSlug === room && state?.role === 'dm' ? state.scene : null;
    }, ops => connection.sendOps(ops));
    void fill();
    const retry = setInterval(() => { void fill(); }, 60_000);
    return () => { cancelled = true; clearInterval(retry); };
  }, [scene, role, connected]);
}
